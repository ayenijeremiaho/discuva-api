import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NotificationTemplateService } from './notification-template.service';
import { PUSH_CATALOGUE, PushNotificationKey } from '../push-catalogue';

describe('NotificationTemplateService', () => {
  const repo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((v) => ({ ...v })),
    save: jest.fn((v) => Promise.resolve({ ...v, id: 'row-1' })),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const cache = {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn(),
    del: jest.fn(),
  };
  const audit = { log: jest.fn() };
  const plans = { resolve: jest.fn() };
  const cls = { get: jest.fn().mockReturnValue('tenant-1') };
  const service = new NotificationTemplateService(
    repo as any,
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
        service.savePush(KEY, { title: 'Hi {{first_name}}', body: 'x' }),
      ).rejects.toThrow(
        "Title uses {{first_name}}, which this notification doesn't have. Available: {{meeting_date}}.",
      );
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
});
