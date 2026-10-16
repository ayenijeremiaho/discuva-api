// AnnouncementService pulls in jsdom through SanitizationService.
jest.mock('../../utility/service/sanitization.service', () => ({
  SanitizationService: jest.fn(),
}));

import { SocialLiveScheduler, LiveWatch } from './social-live.scheduler';
import { SocialPlatform } from '../enum/social-media.enum';

describe('SocialLiveScheduler', () => {
  const accountRepo = { find: jest.fn(), update: jest.fn() };
  const slotRepo = { findOne: jest.fn() };
  const meta = {
    getLiveFacebookVideo: jest.fn(),
    getLiveInstagramMedia: jest.fn(),
  };
  const tokens = { getValidAccessToken: jest.fn() };
  const live = { announce: jest.fn().mockResolvedValue(undefined) };
  const gate = {
    activeTenants: jest
      .fn()
      .mockResolvedValue([{ id: 't1', schemaName: 'grace' }]),
  };
  const txHost = {
    withTransaction: jest.fn((fn: () => Promise<unknown>) => fn()),
    tx: { query: jest.fn() },
  };
  const churchSettings = { isEnabled: jest.fn() };
  const planFeatures = { resolve: jest.fn() };
  const redis = new Map<string, unknown>();
  const cache = {
    getGlobal: jest.fn((k: string) =>
      Promise.resolve(structuredClone(redis.get(k))),
    ),
    setGlobal: jest.fn((k: string, v: unknown) => {
      redis.set(k, structuredClone(v));
      return Promise.resolve();
    }),
    delGlobal: jest.fn((k: string) => Promise.resolve(+redis.delete(k))),
  };
  const encryption = {
    encrypt: (s: string) => `enc(${s})`,
    decrypt: (s: string) => s.slice(4, -1),
  };
  const cls = {
    get: jest.fn().mockReturnValue('t1'),
    runWith: jest.fn((_store: unknown, fn: () => Promise<unknown>) => fn()),
  };
  const scheduler = new SocialLiveScheduler(
    accountRepo as never,
    slotRepo as never,
    meta as never,
    tokens as never,
    live as never,
    gate as never,
    txHost as never,
    churchSettings as never,
    planFeatures as never,
    cache as never,
    encryption as never,
    cls as never,
  );

  const now = new Date('2026-10-18T08:00:00Z');
  const slotEnd = new Date('2026-10-18T10:00:00Z');
  const watchOf = () => redis.get('social-live:watch:t1') as LiveWatch;

  beforeEach(() => {
    jest.clearAllMocks();
    redis.clear();
    churchSettings.isEnabled.mockResolvedValue(true);
    planFeatures.resolve.mockResolvedValue({
      features: ['social_media'],
      overrides: {},
    });
    accountRepo.find.mockResolvedValue([
      {
        id: 'a1',
        platform: SocialPlatform.FACEBOOK,
        externalAccountId: 'page1',
        lastLiveId: null,
        tokenExpiresAt: null,
      },
      {
        id: 'a2',
        platform: SocialPlatform.INSTAGRAM,
        externalAccountId: 'ig1',
        lastLiveId: 'old',
        tokenExpiresAt: null,
      },
    ]);
    slotRepo.findOne.mockResolvedValue({
      id: 's1',
      endTime: slotEnd,
      event: { id: 'e1', name: 'Sunday Service' },
    });
    tokens.getValidAccessToken.mockImplementation((id: string) =>
      Promise.resolve(`tok-${id}`),
    );
    meta.getLiveFacebookVideo.mockResolvedValue(null);
    meta.getLiveInstagramMedia.mockResolvedValue(null);
  });

  describe('plan (database, once per service window)', () => {
    it('stores the watch until the service ends, with tokens still encrypted', async () => {
      const next = await scheduler.plan(now);
      expect(next).toEqual(slotEnd);
      expect(watchOf()).toEqual({
        until: slotEnd.getTime(),
        eventName: 'Sunday Service',
        accounts: [
          {
            id: 'a1',
            platform: SocialPlatform.FACEBOOK,
            externalId: 'page1',
            token: 'enc(tok-a1)',
            lastLiveId: null,
          },
          {
            id: 'a2',
            platform: SocialPlatform.INSTAGRAM,
            externalId: 'ig1',
            token: 'enc(tok-a2)',
            lastLiveId: 'old',
          },
        ],
      });
      expect(meta.getLiveFacebookVideo).not.toHaveBeenCalled();
    });

    it('ends the watch early when a token expires mid-service', async () => {
      accountRepo.find.mockResolvedValue([
        {
          id: 'a1',
          platform: SocialPlatform.FACEBOOK,
          externalAccountId: 'page1',
          lastLiveId: null,
          tokenExpiresAt: new Date('2026-10-18T09:00:00Z'),
        },
      ]);
      await expect(scheduler.plan(now)).resolves.toEqual(
        new Date('2026-10-18T08:55:00Z'),
      );
    });

    it('sleeps until 15 minutes before the next service and clears any watch', async () => {
      redis.set('social-live:watch:t1', { until: 1, accounts: [] });
      slotRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ startTime: new Date('2026-10-18T17:00:00Z') });
      await expect(scheduler.plan(now)).resolves.toEqual(
        new Date('2026-10-18T16:45:00Z'),
      );
      expect(watchOf()).toBeUndefined();
    });

    it('watches nothing without the module, its plan, or accounts', async () => {
      churchSettings.isEnabled.mockResolvedValueOnce(false);
      await expect(scheduler.plan(now)).resolves.toBeNull();
      planFeatures.resolve.mockResolvedValueOnce({
        features: [],
        overrides: {},
      });
      await expect(scheduler.plan(now)).resolves.toBeNull();
      planFeatures.resolve.mockResolvedValueOnce({
        features: ['social_media'],
        overrides: { social_media: false },
      });
      await expect(scheduler.plan(now)).resolves.toBeNull();
      accountRepo.find.mockResolvedValueOnce([]);
      await expect(scheduler.plan(now)).resolves.toBeNull();
      expect(slotRepo.findOne).not.toHaveBeenCalled();
      expect(watchOf()).toBeUndefined();
    });

    it('runs for a church given the module by override', async () => {
      planFeatures.resolve.mockResolvedValue({
        features: [],
        overrides: { social_media: true },
      });
      await scheduler.plan(now);
      expect(watchOf().accounts).toHaveLength(2);
    });

    it('leaves out an account whose token cannot be loaded', async () => {
      tokens.getValidAccessToken.mockImplementation((id: string) =>
        id === 'a1'
          ? Promise.reject(new Error('reconnect'))
          : Promise.resolve('tok'),
      );
      await scheduler.plan(now);
      expect(watchOf().accounts.map((a) => a.id)).toEqual(['a2']);
    });
  });

  describe('checkWatches (no database unless announcing)', () => {
    beforeEach(() => scheduler.plan(now));

    it('makes no database call while nobody is live', async () => {
      jest.clearAllMocks();
      await scheduler.checkWatches(now);
      expect(meta.getLiveFacebookVideo).toHaveBeenCalledWith('page1', 'tok-a1');
      expect(meta.getLiveInstagramMedia).toHaveBeenCalledWith('ig1', 'tok-a2');
      expect(txHost.withTransaction).not.toHaveBeenCalled();
      expect(accountRepo.find).not.toHaveBeenCalled();
      expect(slotRepo.findOne).not.toHaveBeenCalled();
      expect(tokens.getValidAccessToken).not.toHaveBeenCalled();
    });

    it('announces a broadcast once, titled with the service when Meta has none', async () => {
      meta.getLiveFacebookVideo.mockResolvedValue({
        id: 'v1',
        title: null,
        url: 'https://www.facebook.com/page1/videos/v1/',
      });
      await scheduler.checkWatches(now);
      await scheduler.checkWatches(new Date(now.getTime() + 120_000));
      expect(live.announce).toHaveBeenCalledTimes(1);
      expect(live.announce).toHaveBeenCalledWith({
        platform: 'Facebook',
        title: 'Sunday Service',
        url: 'https://www.facebook.com/page1/videos/v1/',
      });
      expect(accountRepo.update).toHaveBeenCalledWith('a1', {
        lastLiveId: 'v1',
      });
      expect(txHost.tx.query).toHaveBeenCalledWith(
        'SET LOCAL search_path TO "grace", public',
      );
      expect(watchOf().accounts[0].lastLiveId).toBe('v1');
    });

    it('skips a broadcast announced before the watch was built', async () => {
      meta.getLiveInstagramMedia.mockResolvedValue({
        id: 'old',
        title: null,
        url: 'u',
      });
      await scheduler.checkWatches(now);
      expect(live.announce).not.toHaveBeenCalled();
    });

    it('keeps checking other accounts when one fails, and does not retry a failed announcement', async () => {
      meta.getLiveFacebookVideo.mockRejectedValue(new Error('token expired'));
      meta.getLiveInstagramMedia.mockResolvedValue({
        id: 'new',
        title: 'Evening',
        url: 'https://www.instagram.com/grace/live/',
      });
      live.announce.mockRejectedValueOnce(new Error('db down'));
      await scheduler.checkWatches(now);
      await scheduler.checkWatches(new Date(now.getTime() + 120_000));
      expect(live.announce).toHaveBeenCalledTimes(1);
      expect(live.announce).toHaveBeenCalledWith(
        expect.objectContaining({ platform: 'Instagram', title: 'Evening' }),
      );
    });

    it('stops at the end of the window', async () => {
      jest.clearAllMocks();
      await scheduler.checkWatches(slotEnd);
      expect(meta.getLiveFacebookVideo).not.toHaveBeenCalled();
    });

    it('skips churches with no watch', async () => {
      redis.clear();
      jest.clearAllMocks();
      await scheduler.checkWatches(now);
      expect(meta.getLiveFacebookVideo).not.toHaveBeenCalled();
    });
  });
});
