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
    history: jest.fn().mockResolvedValue([]),
    restorePush: jest.fn(),
    restoreEmail: jest.fn(),
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
  const mine = {
    first_name: 'Tunde',
    last_name: 'Bello',
    full_name: 'Tunde Bello',
    email: 'admin@example.com',
    phone: '',
    title: 'Mr',
    church_title: 'Brother',
    department: '',
  };
  const recipients = {
    byMemberIds: jest.fn(),
  };
  const controller = new NotificationTemplateController(
    templates as any,
    push as any,
    emailQueue as any,
    sanitization as any,
    recipients as any,
  );
  const admin = {
    member: { id: 'member-1', email: 'admin@example.com' },
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    recipients.byMemberIds.mockResolvedValue(new Map([['member-1', mine]]));
  });

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

    it("uses the admin's own details, or samples if they can't be found", async () => {
      push.hasSubscription.mockResolvedValue(true);
      const draft = { title: 'Hi {{church_title}} {{last_name}}' };

      await controller.testPush(KEY, draft, admin);
      recipients.byMemberIds.mockResolvedValueOnce(new Map());
      await controller.testPush(KEY, draft, admin);

      const titles = push.dispatchToMemberIds.mock.calls.map(
        (call) => (call[1] as { title: string }).title,
      );
      expect(titles).toEqual(['Hi Brother Bello', 'Hi Sister Obi']);
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
        '[Test] Happy Birthday, Tunde!',
        expect.stringContaining('Happy Birthday'),
      );
    });

    it("fills the test with the admin's own details, leaving unknown ones blank", async () => {
      templates.resolveEmailWording.mockResolvedValueOnce({
        ...defaultWording(KEY),
        message: '<p>Dear {{church_title}} {{full_name}} [{{department}}]</p>',
      });

      await controller.testEmail(KEY, {}, admin);

      expect(recipients.byMemberIds).toHaveBeenCalledWith(['member-1']);
      const html = emailQueue.queueEmail.mock.calls[0][2] as string;
      expect(html).toContain('Dear Brother Tunde Bello []');
      expect(html).not.toContain('Ada');
    });

    it('keeps sample details in previews', async () => {
      const { html } = await controller.previewEmail(KEY, {});
      expect(recipients.byMemberIds).not.toHaveBeenCalled();
      expect(html).toContain('Ada');
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

  describe('history', () => {
    it('reads each channel', async () => {
      await controller.pushHistory('k');
      await controller.emailHistory('k');
      expect(templates.history).toHaveBeenCalledWith('PUSH', 'k');
      expect(templates.history).toHaveBeenCalledWith('EMAIL', 'k');
    });

    it('restores with the acting admin and the email sanitizer', async () => {
      await controller.restorePush('k', 'v1', admin);
      await controller.restoreEmail('k', 'v2', admin);

      expect(templates.restorePush).toHaveBeenCalledWith('k', 'v1', 'member-1');
      const [, , sanitize, actor] = templates.restoreEmail.mock.calls[0];
      expect(sanitize('<p>x</p>')).toBe('clean:<p>x</p>');
      expect(actor).toBe('member-1');
    });
  });
});
