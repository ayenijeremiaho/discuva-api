import { Test, TestingModule } from '@nestjs/testing';
import { NotificationDispatchService } from './notification-dispatch.service';
import { EmailQueueService } from './email-queue.service';
import { EmailCategorySettingsService } from '../../email-category-settings/service/email-category-settings.service';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';
import { EmailCategory } from '../email-provider/email-category.enum';

const mockEmailQueueService = {
  queueEmailWithTemplate: jest.fn(),
  queueEmailWithTemplateAndAttachments: jest.fn(),
};

const mockEmailCategorySettingsService = {
  isEnabled: jest.fn(),
};

const mockPushNotificationService = {
  dispatchToMemberIds: jest.fn(),
};

describe('NotificationDispatchService', () => {
  let service: NotificationDispatchService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockEmailCategorySettingsService.isEnabled.mockResolvedValue(true);

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
        title: 'Subject',
        body: 'Body',
        url: '/events',
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
      idempotencyKey: 'key-1',
      title: 'Subject',
      body: 'Body',
      url: '/events',
    });
  });

  it('suppresses BOTH email and push when the category is disabled — the actual bug this fixes', async () => {
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
        title: 'Subject',
        body: 'Body',
        url: '/events',
        idempotencyKey: 'key-1',
      },
    });

    expect(mockEmailQueueService.queueEmailWithTemplate).not.toHaveBeenCalled();
    expect(
      mockPushNotificationService.dispatchToMemberIds,
    ).not.toHaveBeenCalled();
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

  it('sends push only when no email option is given', async () => {
    await service.notifyMember({
      category: EmailCategory.EVENT_REMINDER,
      push: {
        memberIds: ['member-1', 'member-2'],
        title: 'Reminder',
        body: 'Starting soon',
        url: '/events',
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
});
