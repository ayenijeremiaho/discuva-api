import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';

// Deletes the lock only if this instance still holds it.
const RELEASE_LOCK = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;

// Counts a hit in a window shared by every instance; starts a block once the limit is passed.
// Returns hits, ms left in the window, ms left in the block.
const HIT_WINDOW = `
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) ttl = tonumber(ARGV[1]) end
local blocked = redis.call('PTTL', KEYS[2])
if blocked < 0 then
  blocked = 0
  if hits > tonumber(ARGV[2]) then redis.call('SET', KEYS[2], '1', 'PX', ARGV[3]) blocked = tonumber(ARGV[3]) end
end
return {hits, ttl, blocked}`;

// Locks taken but never released (left to expire) are forgotten after this many.
const MAX_HELD_LOCKS = 1000;

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
  // Locks this instance holds: scoped key → its token.
  private readonly heldLocks = new Map<string, string>();
  private accessStats: { hits: number; misses: number } = {
    hits: 0,
    misses: 0,
  };

  constructor(
    private readonly configService: ConfigService,
    private readonly cls: ClsService<AppClsStore>,
  ) {
    const tls = this.configService.get<boolean>('REDIS_TLS');
    this.redis = new Redis({
      host: this.configService.get<string>('REDIS_HOST'),
      port: this.configService.get<number>('REDIS_PORT'),
      password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
      db: this.configService.get<number>('REDIS_DB'),
      ...(tls && { tls: {} }),
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

  // Every Redis-touching method below routes its key through this, so no
  // call site needs to remember to namespace by tenant itself. TenantMiddleware
  // (docs/MULTI_TENANT_MIGRATION.md §4.3/§4.5) is live, so tenantId reflects
  // the real tenant on every tenant-scoped request; falls back to 'global'
  // only on tenant-excluded routes (platform-admin, signup, health checks).
  private scopedKey(key: string): string {
    const tenantId = this.cls.get('tenantId') ?? 'global';
    return `tenant:${tenantId}:${key}`;
  }

  private async getByKey<T>(key: string): Promise<T | undefined> {
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

  private async setByKey<T>(key: string, value: T, ttl: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), 'EX', ttl);
    this.logger.debug(`Cache SET: ${key} (TTL: ${ttl}s)`);
  }

  async get<T>(rawKey: string): Promise<T | undefined> {
    return this.getByKey<T>(this.scopedKey(rawKey));
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

  async set<T>(rawKey: string, value: T, ttl: number = 300): Promise<void> {
    await this.setByKey(this.scopedKey(rawKey), value, ttl);
  }

  // Deliberately NOT tenant-scoped — for data that's the same regardless of
  // which tenant (if any) happens to be in CLS context when it's read, e.g.
  // PlatformSettingsService's values. Using the tenant-scoped get/set/del
  // above for genuinely global data is a real bug: a platform-admin write
  // (no tenant context, scopes to 'global') would never invalidate what a
  // tenant-scoped read cached under that tenant's own id, leaving each
  // tenant serving a stale value until its own cache entry's TTL expires
  // independently — this is exactly the bug PlatformSettingsService hit.
  private globalKey(key: string): string {
    return `global:${key}`;
  }

  async getGlobal<T>(rawKey: string): Promise<T | undefined> {
    return this.getByKey<T>(this.globalKey(rawKey));
  }

  async setGlobal<T>(
    rawKey: string,
    value: T,
    ttl: number = 300,
  ): Promise<void> {
    await this.setByKey(this.globalKey(rawKey), value, ttl);
  }

  async delGlobal(rawKey: string): Promise<number> {
    const key = this.globalKey(rawKey);
    const count = await this.redis.del(key);
    if (count > 0) {
      this.logger.debug(`Cache DEL: ${key}`);
    }
    return count;
  }

  async incr(rawKey: string, ttlSeconds: number): Promise<number> {
    const key = this.scopedKey(rawKey);
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

  async del(rawKey: string): Promise<number> {
    const key = this.scopedKey(rawKey);
    const count = await this.redis.del(key);
    if (count > 0) {
      this.logger.debug(`Cache DEL: ${key}`);
    }
    return count;
  }

  async has(rawKey: string): Promise<boolean> {
    return (await this.redis.exists(this.scopedKey(rawKey))) > 0;
  }

  async blacklistJti(jti: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds > 0) {
      await this.redis.set(
        this.scopedKey(this.key('jti_bl', jti)),
        '1',
        'EX',
        ttlSeconds,
      );
    }
  }

  async isJtiBlacklisted(jti: string): Promise<boolean> {
    return (
      (await this.redis.exists(this.scopedKey(this.key('jti_bl', jti)))) === 1
    );
  }

  async getTTL(rawKey: string): Promise<number | undefined> {
    const ttl = await this.redis.ttl(this.scopedKey(rawKey));
    return ttl < 0 ? undefined : ttl;
  }

  async flush(): Promise<void> {
    await this.redis.flushdb();
    this.logger.log('Cache flushed');
  }

  async flushNamespace(namespace: string): Promise<void> {
    await this.delByPattern(this.scopedKey(`${namespace}:*`));
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

  // The lock holds a token unique to this acquisition, so with several instances running, one whose lock expired
  // mid-job can't release the lock another instance has since taken.
  async acquireLock(rawKey: string, ttlSeconds: number): Promise<boolean> {
    const key = this.scopedKey(rawKey);
    const token = randomUUID();
    const result = await this.redis.set(key, token, 'EX', ttlSeconds, 'NX');
    if (result !== 'OK') return false;
    if (this.heldLocks.size >= MAX_HELD_LOCKS) this.heldLocks.clear();
    this.heldLocks.set(key, token);
    return true;
  }

  releaseLock(rawKey: string): void {
    const key = this.scopedKey(rawKey);
    const token = this.heldLocks.get(key);
    if (!token) return;
    this.heldLocks.delete(key);
    this.redis
      .eval(RELEASE_LOCK, 1, key, token)
      .catch((err: Error) =>
        this.logger.warn(`Could not release lock ${key}: ${err.message}`),
      );
  }

  // Rate-limit counter shared by every instance (see RedisThrottlerStorage).
  async hitWindow(
    rawKey: string,
    windowMs: number,
    limit: number,
    blockMs: number,
  ): Promise<{ hits: number; windowMsLeft: number; blockMsLeft: number }> {
    const key = this.globalKey(rawKey);
    const [hits, windowMsLeft, blockMsLeft] = (await this.redis.eval(
      HIT_WINDOW,
      2,
      key,
      `${key}:blocked`,
      windowMs,
      limit,
      blockMs,
    )) as [number, number, number];
    return { hits, windowMsLeft, blockMsLeft };
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
