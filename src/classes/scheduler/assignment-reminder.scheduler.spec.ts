import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { AssignmentReminderScheduler } from './assignment-reminder.scheduler';
import { Assignment } from '../entity/assignment.entity';
import { ClassEnrollment } from '../entity/class-enrollment.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { UtilityService } from '../../utility/service/utility.service';
import { CacheService } from '../../utility/service/cache.service';
import { SmsService } from '../../sms/service/sms.service';
import { ReminderSettingsService } from '../../reminder-settings/service/reminder-settings.service';

const mockAssignmentRepo = { find: jest.fn() };

const makeEnrollmentQb = () => ({
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  leftJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue([]),
});

const mockEnrollmentRepo = {
  createQueryBuilder: jest.fn(),
};

const mockTenantRepo = { find: jest.fn() };

const mockUtilityService = {
  sendEmailWithTemplate: jest.fn(),
  resolveMemberUrl: jest.fn().mockResolvedValue('https://tenant.app/classes/x'),
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
    thresholds: [3, 1, 0],
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

describe('AssignmentReminderScheduler', () => {
  let scheduler: AssignmentReminderScheduler;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCacheService.acquireLock.mockResolvedValue(true);
    mockCacheService.get.mockResolvedValue(undefined);
    mockReminderSettingsService.getConfig.mockResolvedValue({
      enabled: true,
      thresholds: [3, 1, 0],
      smsEnabled: false,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssignmentReminderScheduler,
        {
          provide: getRepositoryToken(Assignment),
          useValue: mockAssignmentRepo,
        },
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
    scheduler = module.get(AssignmentReminderScheduler);
  });

  it('skips entirely when the tenant has disabled assignment reminders', async () => {
    mockReminderSettingsService.getConfig.mockResolvedValue({
      enabled: false,
      thresholds: [3, 1, 0],
      smsEnabled: false,
    });
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);

    await scheduler.dispatchAssignmentReminders();

    expect(mockAssignmentRepo.find).not.toHaveBeenCalled();
  });

  it('does nothing when no published assignment has a due date within threshold', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30); // outside [3,1,0]
    mockAssignmentRepo.find.mockResolvedValue([
      {
        id: 'assign-1',
        title: 'Quiz',
        dueDate,
        churchClass: { id: 'class-1', name: 'Marriage Counselling' },
      },
    ]);

    await scheduler.dispatchAssignmentReminders();

    expect(mockEnrollmentRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('emails a member enrollee who has not yet submitted, within threshold', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);
    const dueDate = new Date();
    dueDate.setHours(0, 0, 0, 0);
    mockAssignmentRepo.find.mockResolvedValue([
      {
        id: 'assign-1',
        title: 'Quiz',
        dueDate,
        churchClass: { id: 'class-1', name: 'Marriage Counselling' },
      },
    ]);
    const qb = makeEnrollmentQb();
    qb.getMany.mockResolvedValue([
      {
        id: 'enroll-1',
        member: {
          id: 'member-1',
          email: 'w@example.com',
          firstname: 'Ada',
          phoneNumber: '+1234567890',
        },
        guest: null,
      },
    ]);
    mockEnrollmentRepo.createQueryBuilder.mockReturnValue(qb);

    await scheduler.dispatchAssignmentReminders();

    expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
      'w@example.com',
      expect.stringContaining('Due Today'),
      'assignment-due-reminder',
      expect.objectContaining({ assignmentTitle: 'Quiz' }),
      undefined,
      expect.any(String),
    );
    // smsEnabled is false for this tenant — no SMS even though a phone is on file
    expect(mockSmsService.send).not.toHaveBeenCalled();
  });

  it('emails a guest enrollee via their own email, using their guest portal link', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);
    const dueDate = new Date();
    dueDate.setHours(0, 0, 0, 0);
    mockAssignmentRepo.find.mockResolvedValue([
      {
        id: 'assign-1',
        title: 'Quiz',
        dueDate,
        churchClass: { id: 'class-1', name: 'Marriage Counselling' },
      },
    ]);
    const qb = makeEnrollmentQb();
    qb.getMany.mockResolvedValue([
      {
        id: 'enroll-1',
        member: null,
        guest: {
          id: 'guest-1',
          email: 'guest@example.com',
          firstName: 'Chris',
          phone: null,
        },
      },
    ]);
    mockEnrollmentRepo.createQueryBuilder.mockReturnValue(qb);

    await scheduler.dispatchAssignmentReminders();

    expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
      'guest@example.com',
      expect.any(String),
      'assignment-due-reminder',
      expect.any(Object),
      undefined,
      expect.any(String),
    );
    expect(mockUtilityService.resolveMemberUrl).toHaveBeenCalledWith(
      '/classes/guest/enroll-1',
    );
  });

  it('additionally sends SMS when smsEnabled and a phone number is on file', async () => {
    mockReminderSettingsService.getConfig.mockResolvedValue({
      enabled: true,
      thresholds: [3, 1, 0],
      smsEnabled: true,
    });
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);
    const dueDate = new Date();
    dueDate.setHours(0, 0, 0, 0);
    mockAssignmentRepo.find.mockResolvedValue([
      {
        id: 'assign-1',
        title: 'Quiz',
        dueDate,
        churchClass: { id: 'class-1', name: 'Marriage Counselling' },
      },
    ]);
    const qb = makeEnrollmentQb();
    qb.getMany.mockResolvedValue([
      {
        id: 'enroll-1',
        member: {
          id: 'member-1',
          email: 'w@example.com',
          firstname: 'Ada',
          phoneNumber: '+1234567890',
        },
        guest: null,
      },
    ]);
    mockEnrollmentRepo.createQueryBuilder.mockReturnValue(qb);

    await scheduler.dispatchAssignmentReminders();

    expect(mockSmsService.send).toHaveBeenCalledWith(
      ['+1234567890'],
      expect.any(String),
    );
  });

  it('does not send SMS when smsEnabled but no phone number is on file', async () => {
    mockReminderSettingsService.getConfig.mockResolvedValue({
      enabled: true,
      thresholds: [3, 1, 0],
      smsEnabled: true,
    });
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);
    const dueDate = new Date();
    dueDate.setHours(0, 0, 0, 0);
    mockAssignmentRepo.find.mockResolvedValue([
      {
        id: 'assign-1',
        title: 'Quiz',
        dueDate,
        churchClass: { id: 'class-1', name: 'Marriage Counselling' },
      },
    ]);
    const qb = makeEnrollmentQb();
    qb.getMany.mockResolvedValue([
      {
        id: 'enroll-1',
        member: null,
        guest: {
          id: 'guest-1',
          email: 'guest@example.com',
          firstName: 'Chris',
          phone: null,
        },
      },
    ]);
    mockEnrollmentRepo.createQueryBuilder.mockReturnValue(qb);

    await scheduler.dispatchAssignmentReminders();

    expect(mockSmsService.send).not.toHaveBeenCalled();
  });

  it('skips a cache-deduped reminder that already went out today', async () => {
    mockCacheService.get.mockResolvedValue('1');
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);
    const dueDate = new Date();
    dueDate.setHours(0, 0, 0, 0);
    mockAssignmentRepo.find.mockResolvedValue([
      {
        id: 'assign-1',
        title: 'Quiz',
        dueDate,
        churchClass: { id: 'class-1', name: 'Marriage Counselling' },
      },
    ]);
    const qb = makeEnrollmentQb();
    qb.getMany.mockResolvedValue([
      {
        id: 'enroll-1',
        member: {
          id: 'member-1',
          email: 'w@example.com',
          firstname: 'Ada',
          phoneNumber: null,
        },
        guest: null,
      },
    ]);
    mockEnrollmentRepo.createQueryBuilder.mockReturnValue(qb);

    await scheduler.dispatchAssignmentReminders();

    expect(mockUtilityService.sendEmailWithTemplate).not.toHaveBeenCalled();
  });

  it('continues past one tenant failing so the rest still get processed', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
      { id: 't2', subdomain: 'b', schemaName: 'church_b' },
    ]);
    mockAssignmentRepo.find
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue([]);

    await expect(
      scheduler.dispatchAssignmentReminders(),
    ).resolves.toBeUndefined();
    expect(mockCacheService.releaseLock).toHaveBeenCalled();
  });

  it('does nothing when the lock cannot be acquired (another instance already running)', async () => {
    mockCacheService.acquireLock.mockResolvedValue(false);
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);

    await scheduler.dispatchAssignmentReminders();

    expect(mockTenantRepo.find).not.toHaveBeenCalled();
  });
});
