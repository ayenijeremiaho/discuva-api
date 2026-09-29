import { NotificationTemplateController } from './notification-template.controller';
import { PUSH_CATALOGUE, PushNotificationKey } from '../push-catalogue';
import {
  EMAIL_CATALOGUE,
  EmailTemplateKey,
  defaultWording,
} from '../email-catalogue';

jest.mock('../../utility/service/sanitization.service', () => ({
  SanitizationService: class {},
}));

describe('NotificationTemplateController', () => {
  const templates = {
    assertPushKey: jest.fn(
      (key: string) => PUSH_CATALOGUE[key as PushNotificationKey],
    ),
    resolvePushTemplate: jest.fn((key: string) =>
      Promise.resolve(PUSH_CATALOGUE[key as PushNotificationKey]),
    ),
    assertEmailKey: jest.fn(
      (key: string) => EMAIL_CATALOGUE[key as EmailTemplateKey],
    ),
    resolveEmailWording: jest.fn((key: string) =>
      Promise.resolve(defaultWording(key as EmailTemplateKey)),
    ),
    validateEmailWording: jest.fn(
      (dto: object, _template?: unknown, _sanitize?: (h: string) => string) =>
        dto,
    ),
    saveEmail: jest.fn(),
  };
  const push = {
    hasSubscription: jest.fn(),
    dispatchToMemberIds: jest.fn().mockResolvedValue(undefined),
  };
  const emailQueue = {
    getBrandingData: jest
      .fn()
      .mockResolvedValue({ church_name: 'Test Church' }),
    queueEmail: jest.fn().mockResolvedValue('job-1'),
  };
  const sanitization = {
    sanitizeForEmail: jest.fn((h: string) => `clean:${h}`),
  };
  const controller = new NotificationTemplateController(
    templates as any,
    push as any,
    emailQueue as any,
    sanitization as any,
  );
  const admin = {
    member: { id: 'member-1', email: 'admin@example.com' },
  } as any;

  beforeEach(() => jest.clearAllMocks());

  describe('testPush', () => {
    const KEY = PushNotificationKey.PRAYER_ASSIGNED;

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
        controller.testPush(
          KEY,
          { body: 'See you on {{meeting_date}}!' },
          admin,
        ),
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

  describe('email preview and test', () => {
    const KEY = EmailTemplateKey.HAPPY_BIRTHDAY;

    it('previews the current wording with sample details and branding', async () => {
      const { subject, html } = await controller.previewEmail(KEY, {});

      expect(subject).toBe('Happy Birthday, Ada!');
      expect(html).toContain('Test Church');
      expect(templates.validateEmailWording).not.toHaveBeenCalled();
    });

    it('previews an unsaved draft, cleaned through the email sanitizer', async () => {
      await controller.previewEmail(KEY, { heading: 'Cheers, {{first_name}}' });

      expect(templates.validateEmailWording).toHaveBeenCalledWith(
        expect.objectContaining({ heading: 'Cheers, {{first_name}}' }),
        EMAIL_CATALOGUE[KEY],
        expect.any(Function),
      );
      const sanitize = templates.validateEmailWording.mock.calls[0][2] as (
        h: string,
      ) => string;
      expect(sanitize('<p>x</p>')).toBe('clean:<p>x</p>');
    });

    it("sends a test to the admin's own email, marked as a test", async () => {
      await expect(controller.testEmail(KEY, {}, admin)).resolves.toEqual({
        sent: true,
        to: 'admin@example.com',
      });
      expect(emailQueue.queueEmail).toHaveBeenCalledWith(
        'admin@example.com',
        '[Test] Happy Birthday, Ada!',
        expect.stringContaining('Happy Birthday'),
      );
    });

    it('passes the sanitizer to saveEmail', async () => {
      const dto = { ...defaultWording(KEY) };
      await controller.saveEmail(KEY, dto, admin);

      expect(templates.saveEmail).toHaveBeenCalledWith(
        KEY,
        dto,
        expect.any(Function),
        'member-1',
      );
    });
  });
});
