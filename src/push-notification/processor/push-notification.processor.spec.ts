import * as webPush from 'web-push';
import { PushNotificationProcessor } from './push-notification.processor';

jest.mock('web-push', () => ({ sendNotification: jest.fn() }));

const sendNotification = webPush.sendNotification as jest.Mock;

describe('PushNotificationProcessor', () => {
  const subRepo = { delete: jest.fn().mockResolvedValue({ affected: 1 }) };
  const cacheService = {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
  };
  const processor = new PushNotificationProcessor(
    subRepo as any,
    cacheService as any,
    {} as any,
    {} as any,
  );
  const job = {
    memberId: 'member-1',
    endpoint: 'https://web.push.apple.com/abc',
    p256dh: 'p',
    auth: 'a',
    payload: { title: 'Hi', body: 'There', url: '/', idempotencyKey: 'k1' },
  };
  const run = () => (processor as any).doHandle(job);

  beforeEach(() => jest.clearAllMocks());

  it('sends and marks the notification as sent', async () => {
    sendNotification.mockResolvedValue({ statusCode: 201 });

    await run();

    expect(sendNotification).toHaveBeenCalled();
    expect(cacheService.set).toHaveBeenCalledWith(
      'notif:sent:member-1:k1',
      '1',
      86_400,
    );
  });

  it('removes an expired subscription', async () => {
    sendNotification.mockRejectedValue({ statusCode: 410, body: 'Gone' });

    await run();

    expect(subRepo.delete).toHaveBeenCalledWith({ memberId: 'member-1' });
  });

  it.each([
    '{"reason":"VapidPkHashMismatch"}',
    'the VAPID credentials in the authorization header do not correspond to the credentials used to create the subscriptions.',
  ])(
    'removes a subscription made with a different VAPID key (%s)',
    async (body) => {
      sendNotification.mockRejectedValue({ statusCode: 403, body });

      await run();

      expect(subRepo.delete).toHaveBeenCalledWith({ memberId: 'member-1' });
    },
  );

  it('keeps the subscription and reports the push service status on other errors', async () => {
    sendNotification.mockRejectedValue({
      statusCode: 400,
      body: '{"reason":"BadJwtToken"}',
    });

    await expect(run()).rejects.toThrow(
      'Push service responded 400: {"reason":"BadJwtToken"}',
    );
    expect(subRepo.delete).not.toHaveBeenCalled();
  });
});
