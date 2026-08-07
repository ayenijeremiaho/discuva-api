import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { PastorFeedbackReminderScheduler } from './pastor-feedback-reminder.scheduler';
import { Department } from '../../department/entity/department.entity';
import { DepartmentLead } from '../../department/entity/department-lead.entity';
import { DepartmentLeadTypeEnum } from '../../department/enums/department-lead-type.enum';
import { PastorFeedback } from '../entity/pastor-feedback.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { UtilityService } from '../../utility/service/utility.service';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';

const mockDepartmentRepo = { find: jest.fn().mockResolvedValue([]) };
const mockLeadRepo = { find: jest.fn().mockResolvedValue([]) };
const mockFeedbackRepo = { find: jest.fn().mockResolvedValue([]) };
const mockTenantRepo = { find: jest.fn() };
const mockUtilityService = { sendEmailWithTemplate: jest.fn() };
const mockPushService = { dispatchToMemberIds: jest.fn() };
const mockCls = {
  runWith: jest.fn((_store: unknown, fn: () => unknown) => fn()),
};
const mockTxHost = {
  tx: { query: jest.fn() },
  withTransaction: jest.fn((fn: () => unknown) => fn()),
};

describe('PastorFeedbackReminderScheduler', () => {
  let scheduler: PastorFeedbackReminderScheduler;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDepartmentRepo.find.mockResolvedValue([]);
    mockLeadRepo.find.mockResolvedValue([]);
    mockFeedbackRepo.find.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PastorFeedbackReminderScheduler,
        {
          provide: getRepositoryToken(Department),
          useValue: mockDepartmentRepo,
        },
        { provide: getRepositoryToken(DepartmentLead), useValue: mockLeadRepo },
        {
          provide: getRepositoryToken(PastorFeedback),
          useValue: mockFeedbackRepo,
        },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: UtilityService, useValue: mockUtilityService },
        { provide: PushNotificationService, useValue: mockPushService },
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
      ],
    }).compile();
    scheduler = module.get(PastorFeedbackReminderScheduler);
  });

  it('runs the department query once per active tenant, entering each tenant context', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
      { id: 't2', subdomain: 'b', schemaName: 'church_b' },
    ]);

    await scheduler.sendReminders();

    expect(mockDepartmentRepo.find).toHaveBeenCalledTimes(2);
    expect(mockTxHost.tx.query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_a", public',
    );
    expect(mockTxHost.tx.query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_b", public',
    );
  });

  it('reminds the HOD lead of a department that has not submitted feedback', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);
    mockDepartmentRepo.find.mockResolvedValue([
      { id: 'dept-1', name: 'Ushering' },
    ]);
    mockFeedbackRepo.find.mockResolvedValue([]);
    mockLeadRepo.find.mockResolvedValue([
      {
        leadType: DepartmentLeadTypeEnum.HOD,
        workerProfile: {
          member: {
            id: 'member-1',
            email: 'hod@example.com',
            firstname: 'Ada',
          },
        },
      },
    ]);

    await scheduler.sendReminders();

    expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
      'hod@example.com',
      expect.stringContaining('Ushering'),
      'pastor-feedback-reminder',
      expect.objectContaining({ name: 'Ada', departmentName: 'Ushering' }),
      undefined,
      expect.any(String),
    );
    expect(mockPushService.dispatchToMemberIds).toHaveBeenCalledWith(
      ['member-1'],
      expect.objectContaining({
        idempotencyKey: expect.stringContaining('dept-1'),
      }),
    );
  });

  it('continues past one tenant failing so the rest still get processed', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
      { id: 't2', subdomain: 'b', schemaName: 'church_b' },
    ]);
    mockDepartmentRepo.find
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue([]);

    await expect(scheduler.sendReminders()).resolves.toBeUndefined();
    expect(mockDepartmentRepo.find).toHaveBeenCalled();
  });
});
