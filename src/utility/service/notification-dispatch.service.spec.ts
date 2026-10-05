import { Test, TestingModule } from '@nestjs/testing';
import { NotificationDispatchService } from './notification-dispatch.service';
import { EmailQueueService } from './email-queue.service';
import { EmailCategorySettingsService } from '../../email-category-settings/service/email-category-settings.service';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';
import { EmailCategory } from '../email-provider/email-category.enum';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';

const mockEmailQueueService = {
  queueEmailWithTemplate: jest.fn(),
  queueEmailWithTemplateAndAttachments: jest.fn(),
};

const mockEmailCategorySettingsService = {
  isEnabled: jest.fn(),
  isPushFirst: jest.fn(),
};

const mockPushNotificationService = {
  dispatchToMemberIds: jest.fn(),
  membersWithSubscription: jest.fn(),
};

describe('NotificationDispatchService', () => {
  let service: NotificationDispatchService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockEmailCategorySettingsService.isEnabled.mockResolvedValue(true);
    mockEmailCategorySettingsService.isPushFirst.mockResolvedValue(false);
    mockPushNotificationService.membersWithSubscription.mockResolvedValue(
      new Set(),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationDispatchService,
        { provide: EmailQueueService, useValue: mockEmailQueueService },
        {
          provide: EmailCategorySettingsService,
          useValue: mockEmailCategorySettingsService,
        },
        {
          provide: PushNotificationService,
          useValue: mockPushNotificationService,
        },
      ],
    }).compile();

    service = module.get(NotificationDispatchService);
  });

  it('sends both email and push when the category is enabled', async () => {
    await service.notifyMember({
      category: EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT,
      email: {
        to: 'jane@example.com',
        subject: 'Subject',
        template: 'service-slot-assigned',
        data: { name: 'Jane' },
      },
      push: {
        memberIds: ['member-1'],
        key: PushNotificationKey.SERVICE_SLOT_ASSIGNED,
        vars: { service_name: 'Sunday Service' },
        idempotencyKey: 'key-1',
      },
    });

    expect(mockEmailCategorySettingsService.isEnabled).toHaveBeenCalledWith(
      EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT,
    );
    expect(mockEmailQueueService.queueEmailWithTemplate).toHaveBeenCalledWith(
      'jane@example.com',
      'Subject',
      'service-slot-assigned',
      { name: 'Jane' },
      undefined,
      EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT,
    );
    expect(
      mockPushNotificationService.dispatchToMemberIds,
    ).toHaveBeenCalledWith(['member-1'], {
      key: PushNotificationKey.SERVICE_SLOT_ASSIGNED,
      vars: { service_name: 'Sunday Service' },
      idempotencyKey: 'key-1',
    });
  });

  it('email switch off stops the email only — push goes on to its own switch in PushNotificationService', async () => {
    mockEmailCategorySettingsService.isEnabled.mockResolvedValue(false);

    await service.notifyMember({
      category: EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT,
      email: {
        to: 'jane@example.com',
        subject: 'Subject',
        template: 'service-slot-assigned',
        data: {},
      },
      push: {
        memberIds: ['member-1'],
        key: PushNotificationKey.SERVICE_SLOT_ASSIGNED,
        vars: { service_name: 'Sunday Service' },
        idempotencyKey: 'key-1',
      },
    });

    expect(mockEmailQueueService.queueEmailWithTemplate).not.toHaveBeenCalled();
    expect(
      mockPushNotificationService.dispatchToMemberIds,
    ).toHaveBeenCalledWith(
      ['member-1'],
      expect.objectContaining({ idempotencyKey: 'key-1' }),
    );
  });

  it('uses the attachments variant when attachments are given', async () => {
    const attachments = [
      { filename: 'invite.ics', content: Buffer.from('BEGIN:VCALENDAR') },
    ];

    await service.notifyMember({
      category: EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT,
      email: {
        to: 'jane@example.com',
        subject: 'Subject',
        template: 'service-slot-assigned',
        data: {},
        attachments,
      },
    });

    expect(
      mockEmailQueueService.queueEmailWithTemplateAndAttachments,
    ).toHaveBeenCalledWith(
      'jane@example.com',
      'Subject',
      'service-slot-assigned',
      {},
      attachments,
      undefined,
      EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT,
    );
    expect(mockEmailQueueService.queueEmailWithTemplate).not.toHaveBeenCalled();
  });

  it('does not check the email switch for a push-only notification', async () => {
    await service.notifyMember({
      category: EmailCategory.EVENT_REMINDER,
      push: {
        memberIds: ['member-1'],
        key: PushNotificationKey.SERVICE_REMINDER,
        idempotencyKey: 'event-reminder:2',
      },
    });

    expect(mockEmailCategorySettingsService.isEnabled).not.toHaveBeenCalled();
  });

  it('sends push only when no email option is given', async () => {
    await service.notifyMember({
      category: EmailCategory.EVENT_REMINDER,
      push: {
        memberIds: ['member-1', 'member-2'],
        key: PushNotificationKey.SERVICE_REMINDER,
        vars: { service_name: 'Sunday Service', time_until: '1 hour' },
        idempotencyKey: 'event-reminder:1',
      },
    });

    expect(mockEmailQueueService.queueEmailWithTemplate).not.toHaveBeenCalled();
    expect(
      mockEmailQueueService.queueEmailWithTemplateAndAttachments,
    ).not.toHaveBeenCalled();
    expect(
      mockPushNotificationService.dispatchToMemberIds,
    ).toHaveBeenCalledWith(
      ['member-1', 'member-2'],
      expect.objectContaining({ idempotencyKey: 'event-reminder:1' }),
    );
  });

  it('sends email only when no push option is given', async () => {
    await service.notifyMember({
      category: EmailCategory.EVENT_REMINDER,
      email: {
        to: ['a@example.com', 'b@example.com'],
        subject: 'Reminder',
        template: 'service-reminder',
        data: {},
      },
    });

    expect(mockEmailQueueService.queueEmailWithTemplate).toHaveBeenCalled();
    expect(
      mockPushNotificationService.dispatchToMemberIds,
    ).not.toHaveBeenCalled();
  });

  describe('Push first', () => {
    const notify = (recipientMemberId?: string, pushTo = ['member-1']) =>
      service.notifyMember({
        category: EmailCategory.SERVICE_PROGRAMME_ASSIGNMENT,
        email: {
          to: 'jane@example.com',
          subject: 'Subject',
          template: 'service-slot-assigned',
          data: {},
          recipientMemberId,
        },
        push: {
          memberIds: pushTo,
          key: PushNotificationKey.SERVICE_SLOT_ASSIGNED,
          vars: {},
          idempotencyKey: 'k',
        },
      });

    beforeEach(() => {
      mockEmailCategorySettingsService.isPushFirst.mockResolvedValue(true);
    });

    it('skips the email for someone who gets this push on a subscribed device', async () => {
      mockPushNotificationService.membersWithSubscription.mockResolvedValue(
        new Set(['member-1']),
      );

      await notify('member-1');

      expect(
        mockEmailQueueService.queueEmailWithTemplate,
      ).not.toHaveBeenCalled();
      expect(
        mockPushNotificationService.dispatchToMemberIds,
      ).toHaveBeenCalled();
    });

    it('still emails someone without push notifications set up', async () => {
      await notify('member-1');

      expect(mockEmailQueueService.queueEmailWithTemplate).toHaveBeenCalled();
    });

    it('still emails when the push is going to someone else', async () => {
      mockPushNotificationService.membersWithSubscription.mockResolvedValue(
        new Set(['member-1']),
      );

      await notify('member-1', ['member-2']);

      expect(mockEmailQueueService.queueEmailWithTemplate).toHaveBeenCalled();
    });

    it('never suppresses an email whose recipient is unknown', async () => {
      await notify(undefined);

      expect(
        mockPushNotificationService.membersWithSubscription,
      ).not.toHaveBeenCalled();
      expect(mockEmailQueueService.queueEmailWithTemplate).toHaveBeenCalled();
    });

    it('sends the email as usual when the category is not Push first', async () => {
      mockEmailCategorySettingsService.isPushFirst.mockResolvedValue(false);
      mockPushNotificationService.membersWithSubscription.mockResolvedValue(
        new Set(['member-1']),
      );

      await notify('member-1');

      expect(mockEmailQueueService.queueEmailWithTemplate).toHaveBeenCalled();
    });

    it('drops only the subscribed addresses from a multi-recipient email', async () => {
      mockPushNotificationService.membersWithSubscription.mockResolvedValue(
        new Set(['member-1']),
      );

      await service.notifyMember({
        category: EmailCategory.EVENT_REMINDER,
        email: {
          to: ['a@example.com', 'b@example.com'],
          recipientMemberIds: ['member-1', 'member-2'],
          subject: 'Subject',
          template: 'service-reminder',
          data: {},
        },
        push: {
          memberIds: ['member-1', 'member-2'],
          key: PushNotificationKey.SERVICE_REMINDER,
          vars: {},
          idempotencyKey: 'k',
        },
      });

      expect(mockEmailQueueService.queueEmailWithTemplate).toHaveBeenCalledWith(
        ['b@example.com'],
        'Subject',
        'service-reminder',
        {},
        undefined,
        EmailCategory.EVENT_REMINDER,
      );
    });
  });
});
