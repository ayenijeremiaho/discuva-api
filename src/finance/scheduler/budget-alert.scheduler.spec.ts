import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { BudgetAlertScheduler } from './budget-alert.scheduler';
import { Budget } from '../entity/budget.entity';
import { JournalEntryLine } from '../entity/journal-entry-line.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { UtilityService } from '../../utility/service/utility.service';
import { CacheService } from '../../utility/service/cache.service';

const makeAdminQb = (admins: object[]) => ({
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue(admins),
});

const makeLineQb = (rows: object[]) => ({
  innerJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  getRawMany: jest.fn().mockResolvedValue(rows),
});

const mockBudgetRepo = {
  find: jest.fn().mockResolvedValue([]),
  save: jest.fn(),
};
const mockLineRepo = { createQueryBuilder: jest.fn() };
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
  adminRole: { permissions: [AdminPermission.FINANCE_READ] },
};

describe('BudgetAlertScheduler', () => {
  let scheduler: BudgetAlertScheduler;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockBudgetRepo.find.mockResolvedValue([]);
    mockLineRepo.createQueryBuilder.mockReturnValue(makeLineQb([]));
    mockAdminRepo.createQueryBuilder.mockReturnValue(makeAdminQb([admin]));
    mockCacheService.acquireLock.mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetAlertScheduler,
        { provide: getRepositoryToken(Budget), useValue: mockBudgetRepo },
        {
          provide: getRepositoryToken(JournalEntryLine),
          useValue: mockLineRepo,
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
    scheduler = module.get(BudgetAlertScheduler);
  });

  it('runs the budget query once per active tenant, entering each tenant context', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
      { id: 't2', subdomain: 'b', schemaName: 'church_b' },
    ]);

    await scheduler.dispatchBudgetAlerts();

    expect(mockBudgetRepo.find).toHaveBeenCalledTimes(2);
    expect(mockTxHost.tx.query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_a", public',
    );
    expect(mockTxHost.tx.query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_b", public',
    );
  });

  it('sends an exhausted alert and stamps the sent date at 100% utilization', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);
    const budget = {
      id: 'budget-1',
      name: 'Missions',
      amount: 1000,
      alert100SentAt: null,
      alert80SentAt: null,
      account: { normalBalance: 'DEBIT' },
    };
    mockBudgetRepo.find.mockResolvedValue([budget]);
    mockLineRepo.createQueryBuilder.mockReturnValue(
      makeLineQb([{ budgetId: 'budget-1', entryType: 'DEBIT', total: '1000' }]),
    );

    await scheduler.dispatchBudgetAlerts();

    expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
      'admin@example.com',
      expect.stringContaining('Budget Exhausted'),
      'finance-budget-alert',
      expect.any(Object),
      undefined,
      expect.any(String),
    );
    expect(mockBudgetRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ alert100SentAt: expect.any(Date) }),
    );
  });

  it('continues past one tenant failing so the rest still get processed', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
      { id: 't2', subdomain: 'b', schemaName: 'church_b' },
    ]);
    mockBudgetRepo.find
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue([]);

    await expect(scheduler.dispatchBudgetAlerts()).resolves.toBeUndefined();
    expect(mockBudgetRepo.find).toHaveBeenCalled();
    expect(mockCacheService.releaseLock).toHaveBeenCalled();
  });
});
