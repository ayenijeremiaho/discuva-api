import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NotificationTemplateService } from './notification-template.service';
import { PUSH_CATALOGUE, PushNotificationKey } from '../push-catalogue';
import {
  EMAIL_CATALOGUE,
  EmailTemplateKey,
  defaultWording,
} from '../email-catalogue';

describe('NotificationTemplateService', () => {
  const repo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((v) => ({ ...v })),
    save: jest.fn((v) => Promise.resolve({ ...v, id: 'row-1' })),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const versions = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    create: jest.fn((v) => ({ ...v })),
    save: jest.fn((v) => Promise.resolve({ ...v, id: 'v-new' })),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const cache = {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn(),
    del: jest.fn(),
  };
  const audit = { log: jest.fn() };
  const plans = { resolve: jest.fn() };
  const cls = {
    get: jest.fn((key: string) =>
      key === 'schemaName' ? 'church_demo' : 'tenant-1',
    ),
  };
  // Overrides are read with raw schema-qualified SQL; serve repo.find's rows in that shape.
  const dataSource = {
    query: jest.fn(async () =>
      ((await repo.find()) ?? []).map((r: any) => ({
        template_key: r.templateKey,
        title: r.title ?? null,
        body: r.body ?? null,
        content: r.content ?? null,
        updated_at: r.updatedAt,
      })),
    ),
  };
  const service = new NotificationTemplateService(
    dataSource as any,
    repo as any,
    versions as any,
    cache as any,
    audit as any,
    plans as any,
    cls as any,
  );
  const KEY = PushNotificationKey.PRAYER_ASSIGNED;

  function onPlan(hasFeature: boolean) {
    plans.resolve.mockResolvedValue({
      features: hasFeature ? ['notification_customization'] : [],
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    cache.get.mockResolvedValue(undefined);
    repo.find.mockResolvedValue([]);
    repo.findOne.mockResolvedValue(null);
    versions.find.mockResolvedValue([]);
    onPlan(true);
  });

  describe('resolvePushTemplate', () => {
    it("uses the church's wording, falling back per field", async () => {
      repo.find.mockResolvedValue([
        {
          templateKey: KEY,
          title: 'Prayer duty',
          body: null,
          updatedAt: new Date(),
        },
      ]);

      const t = await service.resolvePushTemplate(KEY);

      expect(t.title).toBe('Prayer duty');
      expect(t.body).toBe(PUSH_CATALOGUE[KEY].body);
    });

    it('ignores saved wording once the plan no longer includes customization', async () => {
      onPlan(false);
      repo.find.mockResolvedValue([
        {
          templateKey: KEY,
          title: 'Prayer duty',
          body: 'x',
          updatedAt: new Date(),
        },
      ]);

      const t = await service.resolvePushTemplate(KEY);

      expect(t.title).toBe(PUSH_CATALOGUE[KEY].title);
    });

    it('reads the cached wording without hitting the database', async () => {
      cache.get.mockResolvedValue({});
      await service.resolvePushTemplate(KEY);
      expect(repo.find).not.toHaveBeenCalled();
    });
  });

  describe('savePush', () => {
    it('saves plain text, records who changed it, and clears the cache', async () => {
      const view = await service.savePush(
        KEY,
        {
          title: '<b>Prayer duty</b>',
          body: 'You pray on {{ meeting_date }}.\nThanks!',
        },
        'member-1',
      );

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Prayer duty',
          body: 'You pray on {{ meeting_date }}. Thanks!',
          updatedBy: { id: 'member-1' },
        }),
      );
      expect(cache.del).toHaveBeenCalledWith('notification-overrides:push');
      expect(audit.log).toHaveBeenCalledWith(
        'NOTIFICATION_TEMPLATE_UPDATED',
        expect.objectContaining({ targetId: KEY }),
      );
      expect(view).toMatchObject({ title: 'Prayer duty', customized: true });
    });

    it('rejects placeholders the notification does not have, listing the valid ones', async () => {
      await expect(
        service.savePush(KEY, { title: 'Hi {{amount}}', body: 'x' }),
      ).rejects.toThrow(
        /Title uses {{amount}}, which this notification doesn't have\. Available: .*{{last_name}}.*{{meeting_date}}\./,
      );
    });

    it('accepts recipient details in any push', async () => {
      const view = await service.savePush(KEY, {
        title: 'Hi {{church_title}} {{last_name}}',
        body: 'You are on prayer duty on {{meeting_date}}.',
      });
      expect(view.title).toBe('Hi {{church_title}} {{last_name}}');
      expect(view.placeholders).toMatchObject({
        last_name: 'Obi',
        meeting_date: expect.any(String),
      });
    });

    it('rejects empty wording', async () => {
      await expect(
        service.savePush(KEY, { title: '  <i></i> ', body: 'x' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('stores nothing when the wording matches the default', async () => {
      repo.findOne.mockResolvedValue({ id: 'row-1', title: 'old', body: null });
      const view = await service.savePush(KEY, {
        title: PUSH_CATALOGUE[KEY].title,
        body: PUSH_CATALOGUE[KEY].body,
      });

      expect(repo.delete).toHaveBeenCalledWith({ id: 'row-1' });
      expect(view.customized).toBe(false);
    });

    it('rejects an unknown notification', async () => {
      await expect(
        service.savePush('NOPE', { title: 'a', body: 'b' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  it('resetPush removes the church wording', async () => {
    const view = await service.resetPush(KEY, 'member-1');

    expect(repo.delete).toHaveBeenCalledWith({
      channel: 'PUSH',
      templateKey: KEY,
    });
    expect(cache.del).toHaveBeenCalledWith('notification-overrides:push');
    expect(view).toMatchObject({
      customized: false,
      title: PUSH_CATALOGUE[KEY].title,
    });
  });

  it('listPush returns every catalogue entry and whether the plan allows editing', async () => {
    onPlan(false);
    const { customizationAvailable, items } = await service.listPush();

    expect(customizationAvailable).toBe(false);
    expect(items).toHaveLength(Object.keys(PUSH_CATALOGUE).length);
    expect(items.find((i) => i.key === KEY)).toMatchObject({
      categoryLabel: 'Prayer Reminders',
      defaultTitle: 'Prayer Assignment',
      customized: false,
    });
  });

  describe('emails', () => {
    const EKEY = EmailTemplateKey.HAPPY_BIRTHDAY;
    const clean = (html: string) =>
      html.replace(/<script[\s\S]*?<\/script>/g, '');

    it("resolves the church's changed fields over the defaults", async () => {
      repo.find.mockResolvedValue([
        {
          templateKey: EKEY,
          content: { heading: 'Cheers, {{first_name}}!' },
          updatedAt: new Date(),
        },
      ]);

      const w = await service.resolveEmailWording(EKEY);

      expect(w.heading).toBe('Cheers, {{first_name}}!');
      expect(w.subject).toBe(defaultWording(EKEY).subject);
    });

    it('ignores saved wording on plans without customization', async () => {
      onPlan(false);
      repo.find.mockResolvedValue([
        { templateKey: EKEY, content: { heading: 'x' }, updatedAt: new Date() },
      ]);

      expect((await service.resolveEmailWording(EKEY)).heading).toBe(
        defaultWording(EKEY).heading,
      );
    });

    it('saves only the fields that differ from the default, cleaned', async () => {
      await service.saveEmail(
        EKEY,
        {
          ...defaultWording(EKEY),
          subject: '<b>Happy day</b>, {{first_name}}',
          message: '<p>Hi {{first_name}}</p><script>alert(1)</script>',
        },
        clean,
        'member-1',
      );

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'EMAIL',
          templateKey: EKEY,
          content: {
            subject: 'Happy day, {{first_name}}',
            message: '<p>Hi {{first_name}}</p>',
          },
        }),
      );
      expect(cache.del).toHaveBeenCalledWith('notification-overrides:email');
    });

    it('allows {{church_name}} everywhere but rejects placeholders the email lacks', async () => {
      await expect(
        service.saveEmail(
          EKEY,
          { ...defaultWording(EKEY), signature: '{{church_name}} Youth' },
          clean,
        ),
      ).resolves.toBeDefined();

      await expect(
        service.saveEmail(
          EKEY,
          { ...defaultWording(EKEY), message: '<p>{{amount}}</p>' },
          clean,
        ),
      ).rejects.toThrow(
        "Message uses {{amount}}, which this email doesn't have.",
      );
    });

    it('requires a subject and a message', async () => {
      await expect(
        service.saveEmail(
          EKEY,
          { ...defaultWording(EKEY), subject: ' ' },
          clean,
        ),
      ).rejects.toThrow("Subject can't be empty.");
      await expect(
        service.saveEmail(
          EKEY,
          { ...defaultWording(EKEY), message: '<p> </p>' },
          clean,
        ),
      ).rejects.toThrow("Message can't be empty.");
    });

    it('allows an empty message when the default has none', async () => {
      const view = await service.saveEmail(
        'tithe-statement',
        { ...defaultWording('tithe-statement'), signature: 'Finance' },
        clean,
      );
      expect(view.wording.message).toBe('');
      expect(view.customized).toBe(true);
    });

    it('lists every catalogue email with its group, lock note and placeholders', async () => {
      const { items } = await service.listEmail();
      const welcome = items.find(
        (i) => i.key === EmailTemplateKey.WELCOME_MEMBER,
      );

      expect(items).toHaveLength(Object.keys(EMAIL_CATALOGUE).length);
      expect(items.find((i) => i.key === 'leave-submitted')).toMatchObject({
        categoryLabel: 'Workforce',
      });
      expect(welcome).toMatchObject({
        categoryLabel: 'Account emails',
        placeholders: { church_name: 'Your church', first_name: 'Ada' },
        customized: false,
      });
      expect(welcome?.lockedNote).toMatch(/password/);
    });

    it('resetEmail removes the church wording', async () => {
      await service.resetEmail(EKEY, 'member-1');

      expect(repo.delete).toHaveBeenCalledWith({
        channel: 'EMAIL',
        templateKey: EKEY,
      });
      expect(cache.del).toHaveBeenCalledWith('notification-overrides:email');
    });
  });

  describe('history', () => {
    const EKEY = EmailTemplateKey.HAPPY_BIRTHDAY;

    it('snapshots the full wording on every save and reset', async () => {
      const wording = { ...defaultWording(EKEY), signature: 'The Youth' };
      await service.saveEmail(EKEY, wording, (h) => h, 'member-1');
      await service.resetPush(KEY, 'member-1');

      expect(versions.save).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'EMAIL',
          templateKey: EKEY,
          action: 'SAVED',
          content: wording,
          createdBy: { id: 'member-1' },
        }),
      );
      expect(versions.save).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'PUSH',
          action: 'RESET',
          content: {
            title: PUSH_CATALOGUE[KEY].title,
            body: PUSH_CATALOGUE[KEY].body,
          },
        }),
      );
    });

    it('keeps only the newest 20 versions', async () => {
      versions.find.mockResolvedValueOnce([{ id: 'old-1' }, { id: 'old-2' }]);
      await service.resetEmail(EKEY);

      expect(versions.find).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20 }),
      );
      expect(versions.delete).toHaveBeenCalledWith(['old-1', 'old-2']);
    });

    it('lists versions newest first with who made them', async () => {
      const createdAt = new Date();
      versions.find.mockResolvedValueOnce([
        {
          id: 'v1',
          action: 'SAVED',
          content: { title: 'T', body: 'B' },
          createdAt,
          createdBy: { id: 'm1', firstname: 'Ada', lastname: 'Obi' },
        },
        { id: 'v0', action: 'RESET', content: {}, createdAt, createdBy: null },
      ]);

      const rows = await service.history('PUSH' as any, KEY);

      expect(versions.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { channel: 'PUSH', templateKey: KEY },
          order: { createdAt: 'DESC' },
          take: 20,
        }),
      );
      expect(rows[0]).toEqual({
        id: 'v1',
        action: 'SAVED',
        content: { title: 'T', body: 'B' },
        changedBy: 'Ada Obi',
        createdAt,
      });
      expect(rows[1].changedBy).toBeNull();
    });

    it('rejects an unknown key', async () => {
      await expect(service.history('EMAIL' as any, 'nope')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('restores a push version as a new change', async () => {
      versions.findOne.mockResolvedValue({
        content: { title: 'Old title', body: 'Old body' },
      });

      const view = await service.restorePush(KEY, 'v1', 'member-1');

      expect(versions.findOne).toHaveBeenCalledWith({
        where: { id: 'v1', channel: 'PUSH', templateKey: KEY },
      });
      expect(view.title).toBe('Old title');
      expect(versions.save).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'RESTORED' }),
      );
    });

    it('re-validates an email version before restoring it', async () => {
      versions.findOne.mockResolvedValue({
        content: { ...defaultWording(EKEY), message: '<p>{{gone}}</p>' },
      });

      await expect(
        service.restoreEmail(EKEY, 'v1', (h) => h, 'member-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('404s a version from another template', async () => {
      versions.findOne.mockResolvedValue(null);
      await expect(service.restoreEmail(EKEY, 'v1', (h) => h)).rejects.toThrow(
        'That version no longer exists.',
      );
    });
  });

  describe('sending outside a request', () => {
    it("reads overrides from the church's own schema", async () => {
      await service.resolveEmailWording(EmailTemplateKey.HAPPY_BIRTHDAY);

      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining(
          'FROM "church_demo".notification_template_overrides',
        ),
        ['EMAIL'],
      );
    });

    it('uses the defaults, without querying, when there is no church context', async () => {
      cls.get.mockImplementation(() => undefined);

      await expect(
        service.resolveEmailWording(EmailTemplateKey.HAPPY_BIRTHDAY),
      ).resolves.toEqual(defaultWording(EmailTemplateKey.HAPPY_BIRTHDAY));
      expect(dataSource.query).not.toHaveBeenCalled();

      cls.get.mockImplementation((key: string) =>
        key === 'schemaName' ? 'church_demo' : 'tenant-1',
      );
    });

    it('falls back to the defaults instead of failing the send', async () => {
      dataSource.query.mockRejectedValueOnce(
        new Error('relation "notification_template_overrides" does not exist'),
      );
      await expect(
        service.resolveEmailWording(EmailTemplateKey.HAPPY_BIRTHDAY),
      ).resolves.toEqual(defaultWording(EmailTemplateKey.HAPPY_BIRTHDAY));

      dataSource.query.mockRejectedValueOnce(new Error('db down'));
      await expect(service.resolvePushTemplate(KEY)).resolves.toEqual(
        PUSH_CATALOGUE[KEY],
      );
    });
  });
});
