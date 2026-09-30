import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import * as webPush from 'web-push';
import { PushNotificationService } from './push-notification.service';
import { PushSubscription } from '../entity/push-subscription.entity';
import { EmailCategorySettingsService } from '../../email-category-settings/service/email-category-settings.service';
import {
  PUSH_CATALOGUE,
  PushNotificationKey,
} from '../../notification-catalogue/push-catalogue';
import { NotificationTemplateService } from '../../notification-catalogue/service/notification-template.service';
import { NotificationRecipientService } from '../../notification-catalogue/service/notification-recipient.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

describe('PushNotificationService', () => {
  let service: PushNotificationService;

  const mockSubRepo = {
    delete: jest.fn().mockResolvedValue(undefined),
    save: jest.fn().mockResolvedValue(undefined),
    create: jest.fn().mockImplementation((v) => v),
    find: jest.fn().mockResolvedValue([]),
  };

  const mockWorkerRepo = {
    createQueryBuilder: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    }),
  };

  const mockQueue = {
    add: jest.fn().mockResolvedValue(undefined),
    addBulk: jest.fn().mockResolvedValue(undefined),
  };

  const mockConfig = {
    get: jest.fn().mockReturnValue('test-value'),
  };

  // Subscriptions and worker lookups are schema-qualified raw reads; route them to the repo-style mocks.
  const mockDataSource = {
    query: jest.fn((sql: string, params: unknown[]) =>
      sql.includes('push_subscriptions')
        ? mockSubRepo.find(params)
        : mockWorkerRepo.createQueryBuilder().getRawMany(),
    ),
  };

  const mockClsService = {
    get: jest.fn((key: string) =>
      key === 'schemaName' ? 'church_demo' : undefined,
    ),
    isActive: jest.fn().mockReturnValue(false),
    getId: jest.fn(),
  };

  const mockTemplates = {
    resolvePushTemplate: jest.fn((key: PushNotificationKey) =>
      Promise.resolve(PUSH_CATALOGUE[key]),
    ),
  };

  const mockCategorySettings = {
    isPushEnabled: jest.fn().mockResolvedValue(true),
  };

  const mockRecipients = { byMemberIds: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCategorySettings.isPushEnabled.mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PushNotificationService,
        {
          provide: getRepositoryToken(PushSubscription),
          useValue: mockSubRepo,
        },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: getQueueToken('push-notifications'), useValue: mockQueue },
        { provide: ConfigService, useValue: mockConfig },
        { provide: ClsService, useValue: mockClsService },
        {
          provide: EmailCategorySettingsService,
          useValue: mockCategorySettings,
        },
        { provide: NotificationTemplateService, useValue: mockTemplates },
        { provide: NotificationRecipientService, useValue: mockRecipients },
      ],
    }).compile();

    service = module.get<PushNotificationService>(PushNotificationService);
    service.onModuleInit();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('onModuleInit sets VAPID details', () => {
    expect(webPush.setVapidDetails).toHaveBeenCalledWith(
      'test-value',
      'test-value',
      'test-value',
    );
  });

  describe('subscribe', () => {
    it('deletes existing subscription then saves new one', async () => {
      const dto = {
        endpoint: 'https://push.example.com/sub',
        p256dh: 'key',
        auth: 'auth',
      };
      await service.subscribe('member-1', dto);
      expect(mockSubRepo.delete).toHaveBeenCalledWith({ memberId: 'member-1' });
      expect(mockSubRepo.save).toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    it('deletes the subscription for the given member', async () => {
      await service.unsubscribe('member-1');
      expect(mockSubRepo.delete).toHaveBeenCalledWith({ memberId: 'member-1' });
    });
  });

  describe('dispatchToMemberIds', () => {
    it('does nothing when memberIds is empty', async () => {
      await service.dispatchToMemberIds([], {
        idempotencyKey: 'k',
        title: 't',
        body: 'b',
        url: '/u',
      });
      expect(mockSubRepo.find).not.toHaveBeenCalled();
    });

    it('enqueues all subscriptions in a single bulk call', async () => {
      mockSubRepo.find.mockResolvedValueOnce([
        {
          memberId: 'member-1',
          endpoint: 'https://ep',
          p256dh: 'k',
          auth: 'a',
        },
        {
          memberId: 'member-2',
          endpoint: 'https://ep2',
          p256dh: 'k2',
          auth: 'a2',
        },
      ]);
      await service.dispatchToMemberIds(['member-1', 'member-2'], {
        idempotencyKey: 'prayer-test:1',
        title: 'Test',
        body: 'Body',
        url: '/prayer',
      });
      expect(mockQueue.addBulk).toHaveBeenCalledTimes(1);
      expect(mockQueue.addBulk).toHaveBeenCalledWith([
        expect.objectContaining({
          name: 'send',
          data: expect.objectContaining({ memberId: 'member-1' }),
          opts: expect.objectContaining({
            jobId: 'push:member-1:prayer-test:1',
          }),
        }),
        expect.objectContaining({
          name: 'send',
          data: expect.objectContaining({ memberId: 'member-2' }),
          opts: expect.objectContaining({
            jobId: 'push:member-2:prayer-test:1',
          }),
        }),
      ]);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('skips members without a subscription', async () => {
      mockSubRepo.find.mockResolvedValueOnce([]);
      await service.dispatchToMemberIds(['member-no-sub'], {
        idempotencyKey: 'k',
        title: 't',
        body: 'b',
        url: '/',
      });
      expect(mockQueue.addBulk).not.toHaveBeenCalled();
    });
  });

  describe('dispatchToWorkerProfileIds', () => {
    it('does nothing when workerProfileIds is empty', async () => {
      await service.dispatchToWorkerProfileIds([], {
        idempotencyKey: 'k',
        title: 't',
        body: 'b',
        url: '/',
      });
      expect(mockWorkerRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('resolves member IDs and dispatches', async () => {
      mockWorkerRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([{ memberId: 'member-1' }]),
      });
      mockSubRepo.find.mockResolvedValueOnce([
        {
          memberId: 'member-1',
          endpoint: 'https://ep',
          p256dh: 'k',
          auth: 'a',
        },
      ]);
      await service.dispatchToWorkerProfileIds(['wp-1'], {
        idempotencyKey: 'prayer-auto-assign:prog:1:2026',
        title: 'Prayer',
        body: 'B',
        url: '/prayer',
      });
      expect(mockQueue.addBulk).toHaveBeenCalledTimes(1);
    });
  });

  describe('tenant reads', () => {
    it("reads subscriptions from the church's own schema, so fire-and-forget sends still work", async () => {
      await service.dispatchToMemberIds(['m1'], {
        title: 'T',
        body: 'B',
        url: '/',
        idempotencyKey: 'k',
      });

      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM "church_demo".push_subscriptions'),
        [['m1']],
      );
    });

    it('sends nothing without a church context', async () => {
      mockClsService.get.mockImplementation(() => undefined);

      await service.dispatchToMemberIds(['m1'], {
        title: 'T',
        body: 'B',
        url: '/',
        idempotencyKey: 'k',
      });

      expect(mockDataSource.query).not.toHaveBeenCalled();
      expect(mockQueue.addBulk).not.toHaveBeenCalled();
      mockClsService.get.mockImplementation((key: string) =>
        key === 'schemaName' ? 'church_demo' : undefined,
      );
    });
  });

  describe('catalogue pushes', () => {
    beforeEach(() => {
      mockSubRepo.find.mockResolvedValue([
        { memberId: 'm1', endpoint: 'https://ep', p256dh: 'p', auth: 'a' },
      ]);
    });

    it('fills the catalogue wording and default link', async () => {
      await service.dispatchToMemberIds(['m1'], {
        key: PushNotificationKey.PRAYER_ASSIGNED,
        vars: { meeting_date: '2026-10-04' },
        idempotencyKey: 'k1',
      });

      expect(mockCategorySettings.isPushEnabled).toHaveBeenCalledWith(
        EmailCategory.PRAYER_REMINDER,
      );
      expect(mockQueue.addBulk).toHaveBeenCalledWith([
        expect.objectContaining({
          data: expect.objectContaining({
            payload: {
              title: 'Prayer Assignment',
              body: 'You have been assigned to a prayer meeting on 2026-10-04.',
              url: '/prayer',
              idempotencyKey: 'k1',
            },
          }),
        }),
      ]);
    });

    it("doesn't look up recipients when the wording doesn't use them", async () => {
      await service.dispatchToMemberIds(['m1'], {
        key: PushNotificationKey.PRAYER_ASSIGNED,
        vars: { meeting_date: '2026-10-04' },
        idempotencyKey: 'k1',
      });
      expect(mockRecipients.byMemberIds).not.toHaveBeenCalled();
    });

    it('personalises each member when the wording uses recipient details', async () => {
      mockTemplates.resolvePushTemplate.mockResolvedValueOnce({
        ...PUSH_CATALOGUE[PushNotificationKey.PRAYER_ASSIGNED],
        title: 'Hi {{church_title}} {{last_name}}',
      });
      mockSubRepo.find.mockResolvedValue([
        { memberId: 'm1', endpoint: 'e1', p256dh: 'p', auth: 'a' },
        { memberId: 'm2', endpoint: 'e2', p256dh: 'p', auth: 'a' },
      ]);
      mockRecipients.byMemberIds.mockResolvedValue(
        new Map([
          ['m1', { church_title: 'Sister', last_name: 'Obi' }],
          ['m2', { church_title: 'Brother', last_name: 'Bello' }],
        ]),
      );

      await service.dispatchToMemberIds(['m1', 'm2'], {
        key: PushNotificationKey.PRAYER_ASSIGNED,
        vars: { meeting_date: '2026-10-04' },
        idempotencyKey: 'k1',
      });

      expect(mockRecipients.byMemberIds).toHaveBeenCalledWith(['m1', 'm2']);
      const titles = mockQueue.addBulk.mock.calls[0][0].map(
        (job: { data: { payload: { title: string } } }) =>
          job.data.payload.title,
      );
      expect(titles).toEqual(['Hi Sister Obi', 'Hi Brother Bello']);
    });

    it("sends nothing when the church switched that category's push off", async () => {
      mockCategorySettings.isPushEnabled.mockResolvedValue(false);

      await service.dispatchToMemberIds(['m1'], {
        key: PushNotificationKey.PRAYER_ASSIGNED,
        vars: { meeting_date: '2026-10-04' },
        idempotencyKey: 'k1',
      });

      expect(mockSubRepo.find).not.toHaveBeenCalled();
      expect(mockQueue.addBulk).not.toHaveBeenCalled();
    });

    it('sends admin-written pushes (announcements) as-is, without a category switch', async () => {
      await service.dispatchToMemberIds(['m1'], {
        title: 'Harvest Sunday',
        body: 'Join us this Sunday.',
        url: '/announcements',
        idempotencyKey: 'a1',
      });

      expect(mockCategorySettings.isPushEnabled).not.toHaveBeenCalled();
      expect(mockQueue.addBulk).toHaveBeenCalled();
    });
  });

  it("sends the church's own wording when it has customized a push", async () => {
    mockSubRepo.find.mockResolvedValue([
      { memberId: 'm1', endpoint: 'https://ep', p256dh: 'p', auth: 'a' },
    ]);
    mockTemplates.resolvePushTemplate.mockResolvedValueOnce({
      ...PUSH_CATALOGUE[PushNotificationKey.PRAYER_ASSIGNED],
      title: 'Prayer duty',
      body: 'We pray together on {{meeting_date}}.',
    });

    await service.dispatchToMemberIds(['m1'], {
      key: PushNotificationKey.PRAYER_ASSIGNED,
      vars: { meeting_date: '2026-10-04' },
      idempotencyKey: 'k2',
    });

    expect(mockQueue.addBulk).toHaveBeenCalledWith([
      expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({
            title: 'Prayer duty',
            body: 'We pray together on 2026-10-04.',
          }),
        }),
      }),
    ]);
  });
});
