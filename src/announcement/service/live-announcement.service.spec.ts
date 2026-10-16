// AnnouncementService pulls in jsdom through SanitizationService.
jest.mock('../../utility/service/sanitization.service', () => ({
  SanitizationService: jest.fn(),
}));

import { LiveAnnouncementService } from './live-announcement.service';

describe('LiveAnnouncementService', () => {
  const store = new Map<string, unknown>();
  const cache = {
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn(),
    get: jest.fn((k: string) => Promise.resolve(store.get(k))),
    set: jest.fn((k: string, v: unknown) => {
      store.set(k, v);
      return Promise.resolve();
    }),
  };
  const announcements = {
    createSystemAnnouncement: jest.fn().mockResolvedValue({ id: 'ann-1' }),
    appendToSystemAnnouncement: jest.fn().mockResolvedValue(true),
  };
  const service = new LiveAnnouncementService(
    announcements as never,
    cache as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    store.clear();
    cache.acquireLock.mockResolvedValue(true);
    announcements.appendToSystemAnnouncement.mockResolvedValue(true);
  });

  it('announces the first platform to go live, with one push', async () => {
    await service.announce({
      platform: 'Facebook',
      title: 'Sunday Service',
      url: 'https://www.facebook.com/x/videos/1/',
    });
    expect(announcements.createSystemAnnouncement).toHaveBeenCalledWith(
      '🔴 Live Now: Sunday Service',
      "We're live now on Facebook — tap to watch.\n\nhttps://www.facebook.com/x/videos/1/",
    );
    expect(cache.releaseLock).toHaveBeenCalled();
  });

  it('adds a second platform to the same announcement instead of a new one', async () => {
    await service.announce({ platform: 'YouTube', url: 'https://yt/1' });
    await service.announce({ platform: 'Instagram', url: 'https://ig/live/' });
    expect(announcements.createSystemAnnouncement).toHaveBeenCalledTimes(1);
    expect(announcements.appendToSystemAnnouncement).toHaveBeenCalledWith(
      'ann-1',
      'Also live on Instagram: https://ig/live/',
    );
  });

  it('starts a new announcement if the earlier one was deleted', async () => {
    store.set('live-now', 'gone');
    announcements.appendToSystemAnnouncement.mockResolvedValue(false);
    await service.announce({ platform: 'Facebook', title: ' ', url: 'u' });
    expect(announcements.createSystemAnnouncement).toHaveBeenCalledWith(
      '🔴 Live Now: Service',
      expect.any(String),
    );
  });

  it('waits for a platform announcing at the same moment', async () => {
    cache.acquireLock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await service.announce({ platform: 'Facebook', url: 'u' });
    expect(cache.acquireLock).toHaveBeenCalledTimes(2);
    expect(announcements.createSystemAnnouncement).toHaveBeenCalledTimes(1);
  });
});
