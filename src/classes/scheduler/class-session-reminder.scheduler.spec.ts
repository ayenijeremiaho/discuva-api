import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { ClassSessionReminderScheduler } from './class-session-reminder.scheduler';
import { ChurchClass } from '../entity/church-class.entity';
import { ClassEnrollment } from '../entity/class-enrollment.entity';
import { EnrollmentStatusEnum } from '../enum/enrollment-status.enum';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { UtilityService } from '../../utility/service/utility.service';
import { CacheService } from '../../utility/service/cache.service';
import { SmsService } from '../../sms/service/sms.service';
import { ReminderSettingsService } from '../../reminder-settings/service/reminder-settings.service';

const makeClassQb = () => ({
  where: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue([]),
});

const mockClassRepo = {
  createQueryBuilder: jest.fn(),
};

const mockEnrollmentRepo = { find: jest.fn().mockResolvedValue([]) };

const mockTenantRepo = { find: jest.fn() };

const mockUtilityService = {
  sendEmailWithAttachment: jest.fn(),
};

const mockCacheService = {
  acquireLock: jest.fn().mockResolvedValue(true),
  releaseLock: jest.fn(),
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn(),
};

const mockSmsService = { send: jest.fn().mockResolvedValue([]) };

const mockReminderSettingsService = {
  getConfig: jest.fn().mockResolvedValue({
    enabled: true,
    thresholds: [24, 1],
    smsEnabled: false,
  }),
};

const mockCls = {
  runWith: jest.fn((_store: unknown, fn: () => unknown) => fn()),
};
const mockTxHost = {
  tx: { query: jest.fn() },
  withTransaction: jest.fn((fn: () => unknown) => fn()),
};

describe('ClassSessionReminderScheduler', () => {
  let scheduler: ClassSessionReminderScheduler;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCacheService.acquireLock.mockResolvedValue(true);
    mockCacheService.get.mockResolvedValue(undefined);
    mockEnrollmentRepo.find.mockResolvedValue([]);
    mockReminderSettingsService.getConfig.mockResolvedValue({
      enabled: true,
      thresholds: [24, 1],
      smsEnabled: false,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassSessionReminderScheduler,
        { provide: getRepositoryToken(ChurchClass), useValue: mockClassRepo },
        {
          provide: getRepositoryToken(ClassEnrollment),
          useValue: mockEnrollmentRepo,
        },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: UtilityService, useValue: mockUtilityService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: SmsService, useValue: mockSmsService },
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
        {
          provide: ReminderSettingsService,
          useValue: mockReminderSettingsService,
        },
      ],
    }).compile();
    scheduler = module.get(ClassSessionReminderScheduler);
  });

  it('skips entirely when the tenant has disabled class session reminders', async () => {
    mockReminderSettingsService.getConfig.mockResolvedValue({
      enabled: false,
      thresholds: [24, 1],
      smsEnabled: false,
    });
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);

    await scheduler.dispatchClassSessionReminders();

    expect(mockClassRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('does nothing when no class session falls within threshold hours', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);
    const qb = makeClassQb();
    const farOut = new Date();
    farOut.setHours(farOut.getHours() + 72); // outside [24, 1]
    qb.getMany.mockResolvedValue([
      {
        id: 'class-1',
        name: 'Marriage Counselling',
        nextSessionAt: farOut,
        meetingLink: null,
      },
    ]);
    mockClassRepo.createQueryBuilder.mockReturnValue(qb);

    await scheduler.dispatchClassSessionReminders();

    expect(mockEnrollmentRepo.find).not.toHaveBeenCalled();
  });

  it('emails a member enrollee whose class session is exactly 24 hours away', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);
    const sessionAt = new Date();
    sessionAt.setHours(sessionAt.getHours() + 24);
    const qb = makeClassQb();
    qb.getMany.mockResolvedValue([
      {
        id: 'class-1',
        name: 'Marriage Counselling',
        nextSessionAt: sessionAt,
        meetingLink: 'https://meet.example.com/abc',
      },
    ]);
    mockClassRepo.createQueryBuilder.mockReturnValue(qb);
    mockEnrollmentRepo.find.mockResolvedValue([
      {
        id: 'enroll-1',
        status: EnrollmentStatusEnum.IN_PROGRESS,
        member: {
          id: 'member-1',
          email: 'w@example.com',
          firstname: 'Ada',
          phoneNumber: '+1234567890',
        },
        guest: null,
      },
    ]);

    await scheduler.dispatchClassSessionReminders();

    expect(mockUtilityService.sendEmailWithAttachment).toHaveBeenCalledWith(
      'w@example.com',
      expect.any(String),
      'class-session-reminder',
      expect.objectContaining({
        className: 'Marriage Counselling',
        meetingLink: 'https://meet.example.com/abc',
      }),
      [expect.objectContaining({ filename: 'class-session.ics' })],
      expect.any(String),
    );
    expect(mockSmsService.send).not.toHaveBeenCalled();
  });

  it('attaches a calendar invite with the session start time and meeting link as location', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);
    const sessionAt = new Date();
    sessionAt.setHours(sessionAt.getHours() + 24);
    const qb = makeClassQb();
    qb.getMany.mockResolvedValue([
      {
        id: 'class-1',
        name: 'Marriage Counselling',
        nextSessionAt: sessionAt,
        meetingLink: 'https://meet.example.com/abc',
      },
    ]);
    mockClassRepo.createQueryBuilder.mockReturnValue(qb);
    mockEnrollmentRepo.find.mockResolvedValue([
      {
        id: 'enroll-1',
        status: EnrollmentStatusEnum.IN_PROGRESS,
        member: {
          id: 'member-1',
          email: 'w@example.com',
          firstname: 'Ada',
          phoneNumber: null,
        },
        guest: null,
      },
    ]);

    await scheduler.dispatchClassSessionReminders();

    const [, , , , attachments] =
      mockUtilityService.sendEmailWithAttachment.mock.calls[0];
    const ics = (attachments[0].content as Buffer).toString('utf-8');
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain(`UID:class-1-${sessionAt.getTime()}@classes-session`);
    expect(ics).toContain('SUMMARY:Marriage Counselling');
    expect(ics).toContain('LOCATION:https://meet.example.com/abc');
  });

  it('emails a guest enrollee via their own email', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);
    const sessionAt = new Date();
    sessionAt.setHours(sessionAt.getHours() + 1);
    const qb = makeClassQb();
    qb.getMany.mockResolvedValue([
      {
        id: 'class-1',
        name: 'Marriage Counselling',
        nextSessionAt: sessionAt,
        meetingLink: null,
      },
    ]);
    mockClassRepo.createQueryBuilder.mockReturnValue(qb);
    mockEnrollmentRepo.find.mockResolvedValue([
      {
        id: 'enroll-1',
        status: EnrollmentStatusEnum.IN_PROGRESS,
        member: null,
        guest: {
          id: 'guest-1',
          email: 'guest@example.com',
          firstName: 'Chris',
          phone: null,
        },
      },
    ]);

    await scheduler.dispatchClassSessionReminders();

    expect(mockUtilityService.sendEmailWithAttachment).toHaveBeenCalledWith(
      'guest@example.com',
      expect.any(String),
      'class-session-reminder',
      expect.any(Object),
      [expect.objectContaining({ filename: 'class-session.ics' })],
      expect.any(String),
    );
  });

  it('additionally sends SMS with the meeting link when smsEnabled and a phone is on file', async () => {
    mockReminderSettingsService.getConfig.mockResolvedValue({
      enabled: true,
      thresholds: [24, 1],
      smsEnabled: true,
    });
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);
    const sessionAt = new Date();
    sessionAt.setHours(sessionAt.getHours() + 1);
    const qb = makeClassQb();
    qb.getMany.mockResolvedValue([
      {
        id: 'class-1',
        name: 'Marriage Counselling',
        nextSessionAt: sessionAt,
        meetingLink: 'https://meet.example.com/abc',
      },
    ]);
    mockClassRepo.createQueryBuilder.mockReturnValue(qb);
    mockEnrollmentRepo.find.mockResolvedValue([
      {
        id: 'enroll-1',
        status: EnrollmentStatusEnum.IN_PROGRESS,
        member: {
          id: 'member-1',
          email: 'w@example.com',
          firstname: 'Ada',
          phoneNumber: '+1234567890',
        },
        guest: null,
      },
    ]);

    await scheduler.dispatchClassSessionReminders();

    expect(mockSmsService.send).toHaveBeenCalledWith(
      ['+1234567890'],
      expect.stringContaining('https://meet.example.com/abc'),
    );
  });

  it('skips a cache-deduped reminder already sent for this threshold', async () => {
    mockCacheService.get.mockResolvedValue('1');
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);
    const sessionAt = new Date();
    sessionAt.setHours(sessionAt.getHours() + 1);
    const qb = makeClassQb();
    qb.getMany.mockResolvedValue([
      {
        id: 'class-1',
        name: 'Marriage Counselling',
        nextSessionAt: sessionAt,
        meetingLink: null,
      },
    ]);
    mockClassRepo.createQueryBuilder.mockReturnValue(qb);
    mockEnrollmentRepo.find.mockResolvedValue([
      {
        id: 'enroll-1',
        status: EnrollmentStatusEnum.IN_PROGRESS,
        member: {
          id: 'member-1',
          email: 'w@example.com',
          firstname: 'Ada',
          phoneNumber: null,
        },
        guest: null,
      },
    ]);

    await scheduler.dispatchClassSessionReminders();

    expect(mockUtilityService.sendEmailWithAttachment).not.toHaveBeenCalled();
  });

  it('continues past one tenant failing so the rest still get processed', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
      { id: 't2', subdomain: 'b', schemaName: 'church_b' },
    ]);
    const qb = makeClassQb();
    qb.getMany.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([]);
    mockClassRepo.createQueryBuilder.mockReturnValue(qb);

    await expect(
      scheduler.dispatchClassSessionReminders(),
    ).resolves.toBeUndefined();
    expect(mockCacheService.releaseLock).toHaveBeenCalled();
  });

  it('does nothing when the lock cannot be acquired', async () => {
    mockCacheService.acquireLock.mockResolvedValue(false);

    await scheduler.dispatchClassSessionReminders();

    expect(mockTenantRepo.find).not.toHaveBeenCalled();
  });
});
