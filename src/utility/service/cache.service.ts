import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  keys: number;
  hitRate: number;
}

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly redis: Redis;
  private accessStats: { hits: number; misses: number } = {
    hits: 0,
    misses: 0,
  };

  constructor(private readonly configService: ConfigService) {
    this.redis = new Redis({
      host: this.configService.get<string>('REDIS_HOST'),
      port: this.configService.get<number>('REDIS_PORT'),
      password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
      db: this.configService.get<number>('REDIS_DB'),
      lazyConnect: true,
      retryStrategy: (times: number) => {
        const delay = Math.min(100 * Math.pow(2, times - 1), 30_000);
        this.logger.warn(
          `Redis: reconnect attempt ${times} — retrying in ${delay}ms`,
        );
        return delay;
      },
    });
    this.registerRedisStateListeners();
  }

  async onModuleInit(): Promise<void> {
    const host = this.configService.get<string>('REDIS_HOST');
    const port = this.configService.get<number>('REDIS_PORT');
    const db = this.configService.get<number>('REDIS_DB');
    const hasPassword = !!this.configService.get<string>('REDIS_PASSWORD');
    this.logger.log(
      `Connecting to Redis at ${host}:${port} (db: ${db}, auth: ${hasPassword})`,
    );
    try {
      await this.redis.connect();
    } catch (err) {
      this.logger.error(
        `Redis initial connection failed: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }

  private registerRedisStateListeners(): void {
    this.redis.on('connect', () =>
      this.logger.log('Redis state → connecting (TCP established)'),
    );
    this.redis.on('ready', () => this.logger.log('Redis state → ready'));
    this.redis.on('close', () => this.logger.warn('Redis state → closed'));
    this.redis.on('reconnecting', () =>
      this.logger.warn('Redis state → reconnecting'),
    );
    this.redis.on('end', () =>
      this.logger.error('Redis state → ended (no more reconnects)'),
    );
    this.redis.on('error', (err: Error) =>
      this.logger.error(`Redis error: ${err.message}`),
    );
  }

  key(namespace: string, id: string, suffix?: string): string {
    return suffix ? `${namespace}:${id}:${suffix}` : `${namespace}:${id}`;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const raw = await this.redis.get(key);
    if (raw === null) {
      this.accessStats.misses++;
      this.logger.debug(`Cache MISS: ${key}`);
      return undefined;
    }
    this.accessStats.hits++;
    this.logger.debug(`Cache HIT: ${key}`);
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }

  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttl: number = 300,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== undefined) return cached;

    const value = await fetchFn();
    this.set(key, value, ttl);
    return value;
  }

  async set<T>(key: string, value: T, ttl: number = 300): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), 'EX', ttl);
    this.logger.debug(`Cache SET: ${key} (TTL: ${ttl}s)`);
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    // Lua script makes INCR + EXPIRE atomic — prevents a key with no TTL
    // if the process crashes between the two commands.
    const result = await this.redis.eval(
      `local n = redis.call('INCR', KEYS[1])
       if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
       return n`,
      1,
      key,
      ttlSeconds,
    );
    return result as number;
  }

  async del(key: string): Promise<number> {
    const count = await this.redis.del(key);
    if (count > 0) {
      this.logger.debug(`Cache DEL: ${key}`);
    }
    return count;
  }

  async has(key: string): Promise<boolean> {
    return (await this.redis.exists(key)) > 0;
  }

  async blacklistJti(jti: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds > 0) {
      await this.redis.set(this.key('jti_bl', jti), '1', 'EX', ttlSeconds);
    }
  }

  async isJtiBlacklisted(jti: string): Promise<boolean> {
    return (await this.redis.exists(this.key('jti_bl', jti))) === 1;
  }

  async getTTL(key: string): Promise<number | undefined> {
    const ttl = await this.redis.ttl(key);
    return ttl < 0 ? undefined : ttl;
  }

  async flush(): Promise<void> {
    await this.redis.flushdb();
    this.logger.log('Cache flushed');
  }

  async flushNamespace(namespace: string): Promise<void> {
    await this.delByPattern(`${namespace}:*`);
  }

  async stats(): Promise<CacheStats> {
    const keys = await this.redis.dbsize();
    const total = this.accessStats.hits + this.accessStats.misses;
    return {
      hits: this.accessStats.hits,
      misses: this.accessStats.misses,
      size: keys,
      keys,
      hitRate: total > 0 ? (this.accessStats.hits / total) * 100 : 0,
    };
  }

  resetStats(): void {
    this.accessStats = { hits: 0, misses: 0 };
  }

  async ping(): Promise<void> {
    await this.redis.ping();
  }

  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  releaseLock(key: string): void {
    this.redis.del(key);
  }

  private async delByPattern(pattern: string): Promise<number> {
    let cursor = '0';
    let deleted = 0;
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        deleted += await this.redis.del(...keys);
      }
    } while (cursor !== '0');
    return deleted;
  }
}
