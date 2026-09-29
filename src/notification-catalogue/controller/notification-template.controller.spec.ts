import { NotificationTemplateController } from './notification-template.controller';
import { PUSH_CATALOGUE, PushNotificationKey } from '../push-catalogue';

describe('NotificationTemplateController.testPush', () => {
  const templates = {
    assertPushKey: jest.fn(
      (key: string) => PUSH_CATALOGUE[key as PushNotificationKey],
    ),
    resolvePushTemplate: jest.fn((key: string) =>
      Promise.resolve(PUSH_CATALOGUE[key as PushNotificationKey]),
    ),
  };
  const push = {
    hasSubscription: jest.fn(),
    dispatchToMemberIds: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new NotificationTemplateController(
    templates as any,
    push as any,
  );
  const admin = { member: { id: 'member-1' } } as any;
  const KEY = PushNotificationKey.PRAYER_ASSIGNED;

  beforeEach(() => jest.clearAllMocks());

  it("reports when the admin's own device isn't set up for notifications", async () => {
    push.hasSubscription.mockResolvedValue(false);

    await expect(controller.testPush(KEY, {}, admin)).resolves.toEqual({
      sent: false,
      reason: 'NO_DEVICE',
    });
    expect(push.dispatchToMemberIds).not.toHaveBeenCalled();
  });

  it('sends the unsaved draft filled with sample values to the admin', async () => {
    push.hasSubscription.mockResolvedValue(true);

    await expect(
      controller.testPush(KEY, { body: 'See you on {{meeting_date}}!' }, admin),
    ).resolves.toEqual({ sent: true });

    expect(push.dispatchToMemberIds).toHaveBeenCalledWith(
      ['member-1'],
      expect.objectContaining({
        title: 'Prayer Assignment',
        body: 'See you on 2026-10-04!',
        url: '/prayer',
      }),
    );
  });
});
