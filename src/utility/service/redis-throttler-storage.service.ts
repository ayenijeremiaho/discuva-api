import { Injectable, Logger } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { CacheService } from './cache.service';

// Rate-limit counts kept in Redis, so the limit holds across every API instance (the default storage counts per
// instance, which multiplies the limit by the number of machines).
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  constructor(private readonly cacheService: CacheService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    try {
      const { hits, windowMsLeft, blockMsLeft } =
        await this.cacheService.hitWindow(
          `throttle:${throttlerName}:${key}`,
          ttl,
          limit,
          blockDuration,
        );
      return {
        totalHits: hits,
        timeToExpire: Math.ceil(windowMsLeft / 1000),
        isBlocked: blockMsLeft > 0,
        timeToBlockExpire: Math.ceil(blockMsLeft / 1000),
      };
    } catch (err) {
      // Redis down: let the request through rather than fail every request.
      this.logger.warn(`Rate limit not checked: ${(err as Error).message}`);
      return {
        totalHits: 0,
        timeToExpire: Math.ceil(ttl / 1000),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }
}
