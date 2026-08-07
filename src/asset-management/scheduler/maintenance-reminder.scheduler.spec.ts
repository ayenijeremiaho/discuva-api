import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { MaintenanceReminderScheduler } from './maintenance-reminder.scheduler';
import { MaintenanceSchedule } from '../entity/maintenance-schedule.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { UtilityService } from '../../utility/service/utility.service';
import { CacheService } from '../../utility/service/cache.service';

const makeScheduleQb = (schedules: object[]) => ({
  innerJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue(schedules),
});

const makeAdminQb = (admins: object[]) => ({
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue(admins),
});

const mockScheduleRepo = { createQueryBuilder: jest.fn(), save: jest.fn() };
const mockAdminRepo = { createQueryBuilder: jest.fn() };
const mockTenantRepo = { find: jest.fn() };
const mockUtilityService = { sendEmailWithTemplate: jest.fn() };
const mockCacheService = {
  acquireLock: jest.fn().mockResolvedValue(true),
  releaseLock: jest.fn(),
};
const mockConfigService = {
  get: jest.fn().mockReturnValue('https://admin.example.com'),
};
const mockCls = {
  runWith: jest.fn((_store: unknown, fn: () => unknown) => fn()),
};
const mockTxHost = {
  tx: { query: jest.fn() },
  withTransaction: jest.fn((fn: () => unknown) => fn()),
};

const admin = {
  member: { email: 'admin@example.com' },
  adminRole: { permissions: [AdminPermission.ASSET_MAINTENANCE_ALERT] },
};

describe('MaintenanceReminderScheduler', () => {
  let scheduler: MaintenanceReminderScheduler;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockScheduleRepo.createQueryBuilder.mockReturnValue(makeScheduleQb([]));
    mockAdminRepo.createQueryBuilder.mockReturnValue(makeAdminQb([admin]));
    mockCacheService.acquireLock.mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaintenanceReminderScheduler,
        {
          provide: getRepositoryToken(MaintenanceSchedule),
          useValue: mockScheduleRepo,
        },
        { provide: getRepositoryToken(Admin), useValue: mockAdminRepo },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: UtilityService, useValue: mockUtilityService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
      ],
    }).compile();
    scheduler = module.get(MaintenanceReminderScheduler);
  });

  it('runs the schedule query once per active tenant, entering each tenant context', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
      { id: 't2', subdomain: 'b', schemaName: 'church_b' },
    ]);

    await scheduler.dispatchMaintenanceReminders();

    expect(mockScheduleRepo.createQueryBuilder).toHaveBeenCalledTimes(2);
    expect(mockTxHost.tx.query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_a", public',
    );
    expect(mockTxHost.tx.query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_b", public',
    );
  });

  it('sends a reminder and stamps the notified date at 7 days due', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);
    const nextDueAt = new Date();
    nextDueAt.setDate(nextDueAt.getDate() + 7);
    const schedule = {
      id: 'sched-1',
      nextDueAt,
      notified7DaysAt: null,
      asset: { name: 'Generator', tagNumber: 'AST-2', category: 'equipment' },
    };
    mockScheduleRepo.createQueryBuilder.mockReturnValue(
      makeScheduleQb([schedule]),
    );

    await scheduler.dispatchMaintenanceReminders();

    expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
      'admin@example.com',
      expect.stringContaining('7 days'),
      'asset-maintenance-reminder',
      expect.any(Object),
      undefined,
      expect.any(String),
    );
    expect(mockScheduleRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ notified7DaysAt: expect.any(Date) }),
    );
  });

  it('continues past one tenant failing so the rest still get processed', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
      { id: 't2', subdomain: 'b', schemaName: 'church_b' },
    ]);
    mockScheduleRepo.createQueryBuilder
      .mockReturnValueOnce({
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockRejectedValue(new Error('boom')),
      })
      .mockReturnValue(makeScheduleQb([]));

    await expect(
      scheduler.dispatchMaintenanceReminders(),
    ).resolves.toBeUndefined();
    expect(mockScheduleRepo.createQueryBuilder).toHaveBeenCalled();
    expect(mockCacheService.releaseLock).toHaveBeenCalled();
  });
});
