import { CacheService } from './cache.service';
import { RedisThrottlerStorage } from './redis-throttler-storage.service';

// A Redis stand-in that understands SET NX and the two Lua scripts the service runs.
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    set: jest.fn((key: string, value: string, ...opts: unknown[]) => {
      if (opts.includes('NX') && store.has(key)) return Promise.resolve(null);
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    eval: jest.fn((script: string, _n: number, ...args: unknown[]) => {
      if (script.includes('DEL')) {
        const [key, token] = args as string[];
        if (store.get(key) !== token) return Promise.resolve(0);
        store.delete(key);
        return Promise.resolve(1);
      }
      return Promise.resolve([3, 42_000, 0]);
    }),
    on: jest.fn(),
  };
}

function cacheWith(redis: ReturnType<typeof fakeRedis>, tenantId?: string) {
  const service = new CacheService(
    { get: jest.fn() } as never,
    { get: jest.fn().mockReturnValue(tenantId) } as never,
  );
  (service as unknown as { redis: unknown }).redis = redis;
  return service;
}

describe('CacheService locks across instances', () => {
  it('lets only one instance hold a lock', async () => {
    const redis = fakeRedis();
    const a = cacheWith(redis);
    const b = cacheWith(redis);
    await expect(a.acquireLock('lock:job', 60)).resolves.toBe(true);
    await expect(b.acquireLock('lock:job', 60)).resolves.toBe(false);
  });

  it("never releases a lock another instance took after this one's expired", async () => {
    const redis = fakeRedis();
    const a = cacheWith(redis);
    const b = cacheWith(redis);
    await a.acquireLock('lock:job', 60);
    redis.store.delete('tenant:global:lock:job'); // a's lock expires mid-job
    await b.acquireLock('lock:job', 60);
    a.releaseLock('lock:job');
    await Promise.resolve();
    expect(redis.store.has('tenant:global:lock:job')).toBe(true);
    b.releaseLock('lock:job');
    await Promise.resolve();
    expect(redis.store.has('tenant:global:lock:job')).toBe(false);
  });

  it('ignores releasing a lock this instance never took', () => {
    const redis = fakeRedis();
    cacheWith(redis).releaseLock('lock:job');
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('scopes locks to the church in context', async () => {
    const redis = fakeRedis();
    await cacheWith(redis, 't1').acquireLock('live-now', 30);
    expect(redis.store.has('tenant:t1:live-now')).toBe(true);
  });
});

describe('RedisThrottlerStorage', () => {
  it('reports the shared count, in seconds as the guard expects', async () => {
    const redis = fakeRedis();
    const storage = new RedisThrottlerStorage(cacheWith(redis));
    await expect(
      storage.increment('ip-1', 60_000, 100, 60_000, 'default'),
    ).resolves.toEqual({
      totalHits: 3,
      timeToExpire: 42,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      2,
      'global:throttle:default:ip-1',
      'global:throttle:default:ip-1:blocked',
      60_000,
      100,
      60_000,
    );
  });

  it('blocks once the limit is passed', async () => {
    const redis = fakeRedis();
    redis.eval.mockResolvedValueOnce([101, 30_000, 59_500]);
    const storage = new RedisThrottlerStorage(cacheWith(redis));
    await expect(
      storage.increment('ip-1', 60_000, 100, 60_000, 'default'),
    ).resolves.toEqual(
      expect.objectContaining({ isBlocked: true, timeToBlockExpire: 60 }),
    );
  });

  it('lets requests through when Redis is down', async () => {
    const redis = fakeRedis();
    redis.eval.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const storage = new RedisThrottlerStorage(cacheWith(redis));
    await expect(
      storage.increment('ip-1', 60_000, 100, 60_000, 'default'),
    ).resolves.toEqual(
      expect.objectContaining({ isBlocked: false, totalHits: 0 }),
    );
  });
});
