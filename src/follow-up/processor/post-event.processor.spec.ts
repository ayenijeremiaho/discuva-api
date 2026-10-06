import { ChurchSetting } from '../../church-settings/entity/church-setting.entity';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { FOLLOW_UP_QUEUE, PostEventProcessor } from './post-event.processor';
import { Event } from '../../event/entity/event.entity';
import { Attendance } from '../../attendance/entity/attendance.entity';
import { AttendanceStatusEnum } from '../../attendance/enums/check-in.enum';
import { EmailQueueService } from '../../utility/service/email-queue.service';
import { FollowUpService } from '../service/follow-up.service';

const mockEventRepo = { findOne: jest.fn(), update: jest.fn() };
const mockAttendanceRepo = { find: jest.fn() };
const mockEmailQueue = {
  queueEmailWithTemplate: jest.fn(),
  resolveMemberUrl: jest.fn(),
};
const mockQueue = { add: jest.fn() };
const mockSettingRepo = { findOne: jest.fn() };

describe('PostEventProcessor — online attendance request', () => {
  let processor: PostEventProcessor;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSettingRepo.findOne.mockResolvedValue(null);
    mockEmailQueue.resolveMemberUrl.mockResolvedValue(
      'https://grace.example.com/events/e1',
    );
    const module = await Test.createTestingModule({
      providers: [
        PostEventProcessor,
        { provide: ConfigService, useValue: { get: () => 48 } },
        { provide: EmailQueueService, useValue: mockEmailQueue },
        { provide: FollowUpService, useValue: {} },
        { provide: getQueueToken(FOLLOW_UP_QUEUE), useValue: mockQueue },
        { provide: getRepositoryToken(Event), useValue: mockEventRepo },
        {
          provide: getRepositoryToken(Attendance),
          useValue: mockAttendanceRepo,
        },
        {
          provide: ClsService,
          useValue: { get: jest.fn(), isActive: () => false },
        },
        { provide: TransactionHost, useValue: {} },
        {
          provide: getRepositoryToken(ChurchSetting),
          useValue: mockSettingRepo,
        },
      ],
    }).compile();
    processor = module.get(PostEventProcessor);
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
