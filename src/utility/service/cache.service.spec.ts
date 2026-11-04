import { CacheService } from './cache.service';

const redis = {
  on: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  quit: jest.fn().mockResolvedValue('OK'),
};
jest.mock('ioredis', () => jest.fn(() => redis));

describe('CacheService', () => {
  const config = { get: jest.fn() };
  const cls = { get: jest.fn().mockReturnValue('t1') };
  const cache = new CacheService(config as never, cls as never);

  beforeEach(() => jest.clearAllMocks());

  it("doesn't reject a write or a delete when Redis is down", async () => {
    redis.set.mockRejectedValueOnce(new Error('Connection is closed.'));
    redis.del.mockRejectedValueOnce(new Error('Connection is closed.'));
    await expect(cache.set('k', 1)).resolves.toBeUndefined();
    await expect(cache.del('k')).resolves.toBe(0);
  });

  it('keeps getOrSet working when caching the value fails', async () => {
    redis.get.mockResolvedValueOnce(null);
    redis.set.mockRejectedValueOnce(new Error('Connection is closed.'));
    await expect(cache.getOrSet('k', () => Promise.resolve(7))).resolves.toBe(
      7,
    );
  });

  it('closes Redis at application shutdown, after the queues finish', async () => {
    expect('onModuleDestroy' in cache).toBe(false);
    await cache.onApplicationShutdown();
    expect(redis.quit).toHaveBeenCalled();
  });
});
