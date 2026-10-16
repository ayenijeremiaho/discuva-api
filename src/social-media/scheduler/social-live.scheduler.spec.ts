// AnnouncementService pulls in jsdom through SanitizationService.
jest.mock('../../utility/service/sanitization.service', () => ({
  SanitizationService: jest.fn(),
}));

import { SocialLiveScheduler } from './social-live.scheduler';
import { SocialPlatform } from '../enum/social-media.enum';

describe('SocialLiveScheduler', () => {
  const accountRepo = { find: jest.fn(), update: jest.fn() };
  const slotRepo = { findOne: jest.fn() };
  const meta = {
    getLiveFacebookVideo: jest.fn(),
    getLiveInstagramMedia: jest.fn(),
  };
  const tokens = { getValidAccessToken: jest.fn().mockResolvedValue('tok') };
  const live = { announce: jest.fn().mockResolvedValue(undefined) };
  const churchSettings = { isEnabled: jest.fn() };
  const planFeatures = { resolve: jest.fn() };
  const cls = { get: jest.fn().mockReturnValue('t1') };
  const scheduler = new SocialLiveScheduler(
    accountRepo as never,
    slotRepo as never,
    meta as never,
    tokens as never,
    live as never,
    {} as never,
    {} as never,
    churchSettings as never,
    planFeatures as never,
    {} as never,
    cls as never,
  );

  const now = new Date('2026-10-18T08:00:00Z');
  const facebook = {
    id: 'a1',
    platform: SocialPlatform.FACEBOOK,
    externalAccountId: 'page1',
    lastLiveId: null,
  };
  const instagram = {
    id: 'a2',
    platform: SocialPlatform.INSTAGRAM,
    externalAccountId: 'ig1',
    lastLiveId: 'old',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    churchSettings.isEnabled.mockResolvedValue(true);
    planFeatures.resolve.mockResolvedValue({
      features: ['social_media'],
      overrides: {},
    });
    accountRepo.find.mockResolvedValue([facebook, instagram]);
    slotRepo.findOne.mockResolvedValue({
      id: 's1',
      event: { id: 'e1', name: 'Sunday Service' },
    });
    meta.getLiveFacebookVideo.mockResolvedValue(null);
    meta.getLiveInstagramMedia.mockResolvedValue(null);
  });

  it('announces a Facebook broadcast once, titled with the service when Meta has no title', async () => {
    meta.getLiveFacebookVideo.mockResolvedValue({
      id: 'v1',
      title: null,
      url: 'https://www.facebook.com/page1/videos/v1/',
    });
    const next = await scheduler.runChecks(now);
    expect(accountRepo.update).toHaveBeenCalledWith('a1', { lastLiveId: 'v1' });
    expect(live.announce).toHaveBeenCalledWith({
      platform: 'Facebook',
      title: 'Sunday Service',
      url: 'https://www.facebook.com/page1/videos/v1/',
    });
    expect(next).toEqual(new Date('2026-10-18T08:02:00Z'));
  });

  it('skips a broadcast it already announced', async () => {
    meta.getLiveInstagramMedia.mockResolvedValue({
      id: 'old',
      title: null,
      url: 'u',
    });
    await scheduler.runChecks(now);
    expect(live.announce).not.toHaveBeenCalled();
  });

  it('keeps checking other accounts when one fails', async () => {
    meta.getLiveFacebookVideo.mockRejectedValue(new Error('token expired'));
    meta.getLiveInstagramMedia.mockResolvedValue({
      id: 'new',
      title: null,
      url: 'https://www.instagram.com/grace/live/',
    });
    await scheduler.runChecks(now);
    expect(live.announce).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'Instagram' }),
    );
  });

  it('sleeps until 15 minutes before the next service when none is on', async () => {
    slotRepo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ startTime: new Date('2026-10-18T17:00:00Z') });
    const next = await scheduler.runChecks(now);
    expect(meta.getLiveFacebookVideo).not.toHaveBeenCalled();
    expect(next).toEqual(new Date('2026-10-18T16:45:00Z'));
  });

  it('does nothing without the module, its plan, or accounts to watch', async () => {
    churchSettings.isEnabled.mockResolvedValueOnce(false);
    await expect(scheduler.runChecks(now)).resolves.toBeNull();
    planFeatures.resolve.mockResolvedValueOnce({ features: [], overrides: {} });
    await expect(scheduler.runChecks(now)).resolves.toBeNull();
    planFeatures.resolve.mockResolvedValueOnce({
      features: ['social_media'],
      overrides: { social_media: false },
    });
    await expect(scheduler.runChecks(now)).resolves.toBeNull();
    accountRepo.find.mockResolvedValueOnce([]);
    await expect(scheduler.runChecks(now)).resolves.toBeNull();
    expect(slotRepo.findOne).not.toHaveBeenCalled();
  });

  it('runs for a church given the module by override', async () => {
    planFeatures.resolve.mockResolvedValue({
      features: [],
      overrides: { social_media: true },
    });
    await scheduler.runChecks(now);
    expect(meta.getLiveFacebookVideo).toHaveBeenCalledWith('page1', 'tok');
  });
});
