import { ChurchSetting } from '../../church-settings/entity/church-setting.entity';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import {
  FOLLOW_UP_QUEUE,
  PostEventProcessor,
  THANK_YOU_JOB,
  thankYouDelayMinutes,
} from './post-event.processor';
import { Event } from '../../event/entity/event.entity';
import { Attendance } from '../../attendance/entity/attendance.entity';
import { AttendanceStatusEnum } from '../../attendance/enums/check-in.enum';
import { EmailQueueService } from '../../utility/service/email-queue.service';
import { FollowUpService } from '../service/follow-up.service';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { ReminderSettingsService } from '../../reminder-settings/service/reminder-settings.service';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';

const mockEventRepo = { findOne: jest.fn(), update: jest.fn() };
const mockAttendanceRepo = { find: jest.fn() };
const mockEmailQueue = {
  queueEmailWithTemplate: jest.fn(),
  resolveMemberUrl: jest.fn(),
};
const mockQueue = { add: jest.fn() };
const mockSettingRepo = { findOne: jest.fn() };
const mockNotifications = {
  notifyMember: jest.fn().mockResolvedValue(undefined),
  pushCovered: jest.fn().mockResolvedValue(new Set()),
};
const mockReminderSettings = { getConfig: jest.fn() };
const cls = {
  get: jest.fn().mockReturnValue('tenant_grace'),
  isActive: () => false,
};

async function build(): Promise<PostEventProcessor> {
  const module = await Test.createTestingModule({
    providers: [
      PostEventProcessor,
      { provide: ConfigService, useValue: { get: () => 48 } },
      { provide: EmailQueueService, useValue: mockEmailQueue },
      { provide: FollowUpService, useValue: {} },
      { provide: getQueueToken(FOLLOW_UP_QUEUE), useValue: mockQueue },
      { provide: getRepositoryToken(Event), useValue: mockEventRepo },
      { provide: getRepositoryToken(Attendance), useValue: mockAttendanceRepo },
      { provide: ClsService, useValue: cls },
      { provide: TransactionHost, useValue: {} },
      { provide: getRepositoryToken(ChurchSetting), useValue: mockSettingRepo },
      { provide: NotificationDispatchService, useValue: mockNotifications },
      { provide: ReminderSettingsService, useValue: mockReminderSettings },
    ],
  }).compile();
  return module.get(PostEventProcessor);
}

describe('PostEventProcessor — online attendance request', () => {
  let processor: PostEventProcessor;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSettingRepo.findOne.mockResolvedValue(null);
    mockEmailQueue.resolveMemberUrl.mockResolvedValue(
      'https://grace.example.com/events/e1',
    );
    processor = await build();
  });

  it("links the email's button to the service's page in this church's member app", async () => {
    mockEventRepo.findOne.mockResolvedValue({
      id: 'e1',
      name: 'Sunday Service',
      onlineAttendanceEnabled: true,
      onlineNotificationSentAt: null,
      thankYouSentAt: new Date(),
    });
    mockAttendanceRepo.find.mockResolvedValue([
      {
        status: AttendanceStatusEnum.ABSENT,
        member: { email: 'ada@example.com', firstname: 'Ada' },
      },
    ]);

    await (processor as any).doHandlePostEvent({ eventId: 'e1' });

    expect(mockEmailQueue.resolveMemberUrl).toHaveBeenCalledWith('/events/e1');
    expect(mockEmailQueue.queueEmailWithTemplate).toHaveBeenCalledWith(
      'ada@example.com',
      'Did you attend Sunday Service online?',
      'online-attendance-request',
      expect.objectContaining({
        confirmUrl: 'https://grace.example.com/events/e1',
        windowHours: 48,
      }),
      undefined,
      expect.anything(),
    );
    expect(mockEventRepo.update).toHaveBeenCalledWith(
      'e1',
      expect.objectContaining({
        onlineNotificationSentAt: expect.any(Date),
        onlineConfirmClosesAt: expect.any(Date),
      }),
    );
    expect(mockQueue.add).toHaveBeenCalledWith(
      'online-window-closed',
      expect.anything(),
      expect.objectContaining({ delay: 48 * 3_600_000 }),
    );
  });

  it("uses the church's own window and fixes the closing time on the event", async () => {
    mockSettingRepo.findOne.mockResolvedValue({ value: { minutes: 90 } });
    mockEventRepo.findOne.mockResolvedValue({
      id: 'e1',
      name: 'Sunday Service',
      onlineAttendanceEnabled: true,
      onlineNotificationSentAt: null,
      thankYouSentAt: new Date(),
    });
    mockAttendanceRepo.find.mockResolvedValue([
      {
        status: AttendanceStatusEnum.ABSENT,
        member: { email: 'ada@example.com', firstname: 'Ada' },
      },
    ]);

    await (processor as any).doHandlePostEvent({ eventId: 'e1' });

    const [, fields] = mockEventRepo.update.mock.calls.find(
      ([, f]) => f.onlineConfirmClosesAt,
    );
    expect(
      fields.onlineConfirmClosesAt.getTime() -
        fields.onlineNotificationSentAt.getTime(),
    ).toBe(90 * 60_000);
    expect(mockEmailQueue.queueEmailWithTemplate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'online-attendance-request',
      expect.objectContaining({
        windowHours: 1.5,
        windowLabel: '1 hour 30 minutes',
      }),
      undefined,
      expect.anything(),
    );
  });

  it('sends nothing when online attendance is off for the event', async () => {
    mockEventRepo.findOne.mockResolvedValue({
      id: 'e1',
      onlineAttendanceEnabled: false,
      thankYouSentAt: new Date(),
    });
    mockAttendanceRepo.find.mockResolvedValue([]);

    await (processor as any).doHandlePostEvent({ eventId: 'e1' });

    expect(mockEmailQueue.queueEmailWithTemplate).not.toHaveBeenCalled();
  });
});

describe('PostEventProcessor — thank you', () => {
  let processor: PostEventProcessor;
  const endTime = new Date('2026-10-25T12:00:00Z');

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: new Date('2026-10-25T12:03:00Z') });
    mockReminderSettings.getConfig.mockResolvedValue({
      enabled: true,
      thresholds: [20],
    });
    mockNotifications.pushCovered.mockResolvedValue(new Set());
    processor = await build();
  });

  afterEach(() => jest.useRealTimers());

  it('waits until the set minutes after the service ends, not after absence marking', async () => {
    mockEventRepo.findOne.mockResolvedValue({
      id: 'e1',
      endTime,
      thankYouSentAt: null,
      onlineAttendanceEnabled: false,
    });
    mockAttendanceRepo.find.mockResolvedValue([]);

    await (processor as any).doHandlePostEvent({ eventId: 'e1' });

    expect(mockQueue.add).toHaveBeenCalledWith(
      THANK_YOU_JOB,
      expect.objectContaining({ eventId: 'e1' }),
      expect.objectContaining({
        delay: 17 * 60_000,
        jobId: 'thank-you:tenant_grace:e1',
      }),
    );
    expect(mockEmailQueue.queueEmailWithTemplate).not.toHaveBeenCalled();
  });

  it('sends nothing when the church has turned the thank-you off', async () => {
    mockReminderSettings.getConfig.mockResolvedValue({
      enabled: false,
      thresholds: [20],
    });
    mockEventRepo.findOne.mockResolvedValue({
      id: 'e1',
      endTime,
      thankYouSentAt: null,
      onlineAttendanceEnabled: false,
    });
    mockAttendanceRepo.find.mockResolvedValue([]);

    await (processor as any).doHandlePostEvent({ eventId: 'e1' });

    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('pushes to everyone who attended and emails those the push does not cover', async () => {
    mockEventRepo.findOne.mockResolvedValue({
      id: 'e1',
      name: 'Sunday Service',
      thankYouSentAt: null,
    });
    mockAttendanceRepo.find.mockResolvedValue([
      { member: { id: 'm1', email: 'ada@example.com', firstname: 'Ada' } },
      { member: { id: 'm2', email: 'ben@example.com', firstname: 'Ben' } },
    ]);
    mockNotifications.pushCovered.mockResolvedValue(new Set(['m2']));

    await (processor as any).sendThankYou('e1');

    expect(mockEventRepo.update).toHaveBeenCalledWith('e1', {
      thankYouSentAt: expect.any(Date),
    });
    expect(mockNotifications.notifyMember).toHaveBeenCalledWith(
      expect.objectContaining({
        push: expect.objectContaining({
          memberIds: ['m1', 'm2'],
          key: PushNotificationKey.THANK_YOU_ATTENDANCE,
          vars: { event_name: 'Sunday Service' },
        }),
      }),
    );
    expect(mockEmailQueue.queueEmailWithTemplate).toHaveBeenCalledTimes(1);
    expect(mockEmailQueue.queueEmailWithTemplate).toHaveBeenCalledWith(
      'ada@example.com',
      'Thank you for attending — Sunday Service',
      'thank-you-attendance',
      expect.objectContaining({ name: 'Ada' }),
      undefined,
      expect.anything(),
    );
  });

  it('does not thank anyone twice', async () => {
    mockEventRepo.findOne.mockResolvedValue({
      id: 'e1',
      thankYouSentAt: new Date(),
    });

    await (processor as any).sendThankYou('e1');

    expect(mockAttendanceRepo.find).not.toHaveBeenCalled();
    expect(mockNotifications.notifyMember).not.toHaveBeenCalled();
  });

  it('uses the earliest non-negative minutes, capped at 3 hours', () => {
    expect(thankYouDelayMinutes([30, 15])).toBe(15);
    expect(thankYouDelayMinutes([-5, 0])).toBe(0);
    expect(thankYouDelayMinutes([300])).toBe(180);
    expect(thankYouDelayMinutes([])).toBe(0);
  });
});
