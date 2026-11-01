import { NotificationUsageService } from './notification-usage.service';

describe('NotificationUsageService', () => {
  const cache = {
    hashIncr: jest.fn().mockResolvedValue(undefined),
    hashGetAll: jest.fn().mockResolvedValue({}),
  };
  const service = new NotificationUsageService(cache as any);

  beforeEach(() => jest.clearAllMocks());

  it('adds to the current month', () => {
    service.record('email', 'BIRTHDAY', 'sent', 3);
    expect(cache.hashIncr).toHaveBeenCalledWith(
      `notification-usage:${new Date().toISOString().slice(0, 7)}`,
      'email:BIRTHDAY:sent',
      expect.any(Number),
      3,
    );
  });

  it('skips nothing-to-count calls', () => {
    service.record('sms', 'ANNOUNCEMENTS', 'failed', 0);
    expect(cache.hashIncr).not.toHaveBeenCalled();
  });

  it('never lets a Redis failure reach the send', async () => {
    cache.hashIncr.mockRejectedValueOnce(new Error('down'));
    expect(() => service.record('push', 'NOTES', 'sent')).not.toThrow();
    await new Promise(setImmediate);
  });

  it('reads a month as numbers', async () => {
    cache.hashGetAll.mockResolvedValueOnce({ 'push:NOTES:sent': '4' });
    await expect(service.forMonth(new Date())).resolves.toEqual({
      'push:NOTES:sent': 4,
    });
  });
});
