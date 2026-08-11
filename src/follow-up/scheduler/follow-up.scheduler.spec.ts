import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { FollowUpScheduler } from './follow-up.scheduler';
import { FollowUpTask } from '../entity/follow-up-task.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { FollowUpTaskStatusEnum } from '../enums/follow-up.enum';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { EmailQueueService } from '../../utility/service/email-queue.service';
import { CacheService } from '../../utility/service/cache.service';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { ReminderSettingsService } from '../../reminder-settings/service/reminder-settings.service';

const mockReminderSettingsService = {
  getConfig: jest.fn().mockResolvedValue({ enabled: true, thresholds: [7] }),
};

const mockCacheService = {
  acquireLock: jest.fn().mockResolvedValue(true),
  releaseLock: jest.fn(),
};

const mockTenantRepo = {
  find: jest
    .fn()
    .mockResolvedValue([{ id: 't1', subdomain: 'a', schemaName: 'church_a' }]),
};
const mockCls = {
  runWith: jest.fn((_store: unknown, fn: () => unknown) => fn()),
};
const mockTxHost = {
  tx: { query: jest.fn() },
  withTransaction: jest.fn((fn: () => unknown) => fn()),
};

const mockTaskQb = {
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
  getCount: jest.fn(),
};

const mockAdminQb = {
  innerJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
};

const mockTaskRepo = {
  createQueryBuilder: jest.fn().mockReturnValue(mockTaskQb),
};

const mockAdminRepo = {
  createQueryBuilder: jest.fn().mockReturnValue(mockAdminQb),
};

const mockEmailQueueService = {
  queueEmailWithTemplate: jest.fn(),
};

const mockConfigService = {
  get: jest.fn((key: string, def: any) => def),
};

const makeTask = (
  workerId: string,
  email: string,
  firstname: string,
  dueDate: Date,
) => ({
  id: `task-${workerId}`,
  status: FollowUpTaskStatusEnum.PENDING,
  dueDate,
  firstTimer: { firstname: 'Ada', lastname: 'Obi', phone: '08011111111' },
  assignedTo: {
    member: { id: workerId, email, firstname },
  },
});

describe('FollowUpScheduler', () => {
  let scheduler: FollowUpScheduler;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockTaskQb.getMany.mockResolvedValue([]);
    mockAdminQb.getMany.mockResolvedValue([]);
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);
    mockReminderSettingsService.getConfig.mockResolvedValue({
      enabled: true,
      thresholds: [7],
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FollowUpScheduler,
        { provide: getRepositoryToken(FollowUpTask), useValue: mockTaskRepo },
        { provide: getRepositoryToken(Admin), useValue: mockAdminRepo },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: EmailQueueService, useValue: mockEmailQueueService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
        {
          provide: ReminderSettingsService,
          useValue: mockReminderSettingsService,
        },
      ],
    }).compile();

    scheduler = module.get<FollowUpScheduler>(FollowUpScheduler);
  });

  it('does nothing when there are no overdue tasks', async () => {
    mockTaskQb.getMany.mockResolvedValue([]);
    await scheduler.escalateOverdueTasks();
    expect(mockEmailQueueService.queueEmailWithTemplate).not.toHaveBeenCalled();
  });

  it('sends one digest email per worker with their overdue tasks', async () => {
    const past = new Date('2026-01-01');
    mockTaskQb.getMany.mockResolvedValue([
      makeTask('w1', 'worker1@test.com', 'Chidi', past),
      makeTask('w1', 'worker1@test.com', 'Chidi', past),
      makeTask('w2', 'worker2@test.com', 'Tola', past),
    ]);
    mockAdminQb.getMany.mockResolvedValue([]);

    await scheduler.escalateOverdueTasks();

    const calls = mockEmailQueueService.queueEmailWithTemplate.mock.calls;
    const workerCalls = calls.filter(
      (c: any[]) => c[2] === 'follow-up-overdue-worker',
    );
    expect(workerCalls).toHaveLength(2);
    const chidiCall = workerCalls.find(
      (c: any[]) => c[0] === 'worker1@test.com',
    );
    expect(chidiCall[3].count).toBe(2);
    expect(chidiCall[3].multiple).toBe(true);
  });

  it('sends admin summary email to admins with FOLLOW_UP_WRITE', async () => {
    const past = new Date('2026-01-01');
    mockTaskQb.getMany.mockResolvedValue([
      makeTask('w1', 'worker1@test.com', 'Chidi', past),
    ]);
    mockAdminQb.getMany.mockResolvedValue([
      { member: { email: 'pastor@church.com', firstname: 'Pastor' } },
    ]);

    await scheduler.escalateOverdueTasks();

    const adminCalls =
      mockEmailQueueService.queueEmailWithTemplate.mock.calls.filter(
        (c: any[]) => c[2] === 'follow-up-overdue-admin',
      );
    expect(adminCalls).toHaveLength(1);
    expect(adminCalls[0][0]).toBe('pastor@church.com');
    expect(adminCalls[0][3].count).toBe(1);
    expect(adminCalls[0][3].adminName).toBe('Pastor');
  });

  it('checks for FOLLOW_UP_WRITE permission on admin query', async () => {
    mockTaskQb.getMany.mockResolvedValue([
      makeTask('w1', 'w@test.com', 'W', new Date('2026-01-01')),
    ]);
    await scheduler.escalateOverdueTasks();
    expect(mockAdminQb.andWhere).toHaveBeenCalledWith(
      ':perm = ANY(r.permissions)',
      { perm: AdminPermission.FOLLOW_UP_WRITE },
    );
  });

  it('skips workers without an email address', async () => {
    const past = new Date('2026-01-01');
    mockTaskQb.getMany.mockResolvedValue([
      {
        ...makeTask('w-no-email', '', 'Ghost', past),
        assignedTo: {
          member: { id: 'w-no-email', email: null, firstname: 'Ghost' },
        },
      },
    ]);
    mockAdminQb.getMany.mockResolvedValue([]);

    await scheduler.escalateOverdueTasks();

    const workerCalls =
      mockEmailQueueService.queueEmailWithTemplate.mock.calls.filter(
        (c: any[]) => c[2] === 'follow-up-overdue-worker',
      );
    expect(workerCalls).toHaveLength(0);
  });

  it('skips execution and sends no emails when another instance holds the lock', async () => {
    mockCacheService.acquireLock.mockResolvedValue(false);

    await scheduler.escalateOverdueTasks();

    expect(mockTaskQb.getMany).not.toHaveBeenCalled();
    expect(mockEmailQueueService.queueEmailWithTemplate).not.toHaveBeenCalled();
    expect(mockCacheService.releaseLock).not.toHaveBeenCalled();
  });

  it('releases the lock after execution even when there are no overdue tasks', async () => {
    mockCacheService.acquireLock.mockResolvedValue(true);
    mockTaskQb.getMany.mockResolvedValue([]);

    await scheduler.escalateOverdueTasks();

    expect(mockCacheService.releaseLock).toHaveBeenCalledWith(
      'lock:follow-up-escalation',
    );
  });

  it('runs the overdue-task query once per active tenant, entering each tenant context', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
      { id: 't2', subdomain: 'b', schemaName: 'church_b' },
    ]);
    mockTaskQb.getMany.mockResolvedValue([]);

    await scheduler.escalateOverdueTasks();

    expect(mockTaskRepo.createQueryBuilder).toHaveBeenCalledTimes(2);
    expect(mockTxHost.tx.query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_a", public',
    );
    expect(mockTxHost.tx.query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_b", public',
    );
  });

  it('continues past one tenant failing during escalation so the rest still get processed', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
      { id: 't2', subdomain: 'b', schemaName: 'church_b' },
    ]);
    mockTaskQb.getMany
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue([]);

    await expect(scheduler.escalateOverdueTasks()).resolves.toBeUndefined();
    expect(mockTaskRepo.createQueryBuilder).toHaveBeenCalledTimes(2);
    expect(mockCacheService.releaseLock).toHaveBeenCalled();
  });

  describe('notifyInactiveTasks', () => {
    it('does nothing when there are no inactive tasks', async () => {
      mockTaskQb.getCount.mockResolvedValue(0);
      await scheduler.notifyInactiveTasks();
      expect(
        mockEmailQueueService.queueEmailWithTemplate,
      ).not.toHaveBeenCalled();
    });

    it('sends a stale-task alert to admins with FOLLOW_UP_WRITE', async () => {
      mockTaskQb.getCount.mockResolvedValue(3);
      mockAdminQb.getMany.mockResolvedValue([
        { member: { email: 'pastor@church.com', firstname: 'Pastor' } },
      ]);

      await scheduler.notifyInactiveTasks();

      expect(mockEmailQueueService.queueEmailWithTemplate).toHaveBeenCalledWith(
        'pastor@church.com',
        expect.any(String),
        'follow-up-stale-admin',
        expect.objectContaining({ count: 3 }),
        undefined,
        expect.any(String),
      );
    });

    it('runs the stale-task query once per active tenant, entering each tenant context', async () => {
      mockTenantRepo.find.mockResolvedValue([
        { id: 't1', subdomain: 'a', schemaName: 'church_a' },
        { id: 't2', subdomain: 'b', schemaName: 'church_b' },
      ]);
      mockTaskQb.getCount.mockResolvedValue(0);

      await scheduler.notifyInactiveTasks();

      expect(mockTaskRepo.createQueryBuilder).toHaveBeenCalledTimes(2);
      expect(mockTxHost.tx.query).toHaveBeenCalledWith(
        'SET LOCAL search_path TO "church_a", public',
      );
      expect(mockTxHost.tx.query).toHaveBeenCalledWith(
        'SET LOCAL search_path TO "church_b", public',
      );
    });

    it('continues past one tenant failing so the rest still get processed', async () => {
      mockTenantRepo.find.mockResolvedValue([
        { id: 't1', subdomain: 'a', schemaName: 'church_a' },
        { id: 't2', subdomain: 'b', schemaName: 'church_b' },
      ]);
      mockTaskQb.getCount
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue(0);

      await expect(scheduler.notifyInactiveTasks()).resolves.toBeUndefined();
      expect(mockTaskRepo.createQueryBuilder).toHaveBeenCalledTimes(2);
      expect(mockCacheService.releaseLock).toHaveBeenCalled();
    });

    it('does not check for stale tasks when the tenant has disabled the reminder', async () => {
      mockReminderSettingsService.getConfig.mockResolvedValue({
        enabled: false,
        thresholds: [7],
      });

      await scheduler.notifyInactiveTasks();

      expect(mockTaskRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(
        mockEmailQueueService.queueEmailWithTemplate,
      ).not.toHaveBeenCalled();
    });

    it('honors a tenant-configured staleness threshold instead of the default', async () => {
      mockReminderSettingsService.getConfig.mockResolvedValue({
        enabled: true,
        thresholds: [14],
      });
      mockTaskQb.getCount.mockResolvedValue(2);
      mockAdminQb.getMany.mockResolvedValue([
        { member: { email: 'pastor@church.com', firstname: 'Pastor' } },
      ]);

      await scheduler.notifyInactiveTasks();

      expect(mockEmailQueueService.queueEmailWithTemplate).toHaveBeenCalledWith(
        'pastor@church.com',
        expect.stringContaining('14+'),
        'follow-up-stale-admin',
        expect.objectContaining({ count: 2, staleDays: 14 }),
        undefined,
        expect.any(String),
      );
    });
  });
});
