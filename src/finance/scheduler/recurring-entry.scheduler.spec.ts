import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { RecurringEntryScheduler } from './recurring-entry.scheduler';
import { RecurringEntry } from '../entity/recurring-entry.entity';
import { AccountingPeriod } from '../entity/accounting-period.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { CacheService } from '../../utility/service/cache.service';
import {
  AccountingPeriodStatus,
  RecurringFrequency,
} from '../enum/finance.enum';

const mockRecurringRepo = { find: jest.fn().mockResolvedValue([]) };
const mockPeriodRepo = { findOne: jest.fn() };
const mockTenantRepo = { find: jest.fn() };
const mockCacheService = {
  acquireLock: jest.fn().mockResolvedValue(true),
  releaseLock: jest.fn(),
};

const mockManager = {
  query: jest.fn().mockResolvedValue(undefined),
  findOne: jest.fn().mockResolvedValue(null),
  create: jest.fn((_entity: unknown, data: object) => data),
  save: jest.fn((_entity: unknown, data: any) =>
    Promise.resolve({ id: 'entry-1', ...data }),
  ),
};

const mockCls = {
  runWith: jest.fn((_store: unknown, fn: () => unknown) => fn()),
};
const mockTxHost = {
  tx: mockManager,
  withTransaction: jest.fn((fn: () => unknown) => fn()),
};

const openPeriod = {
  id: 'period-1',
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  status: AccountingPeriodStatus.OPEN,
};

const dueEntry = (overrides: object = {}) => ({
  id: 'recurring-1',
  description: 'Monthly rent',
  amount: 500,
  frequency: RecurringFrequency.MONTHLY,
  debitAccount: { id: 'acc-debit' },
  creditAccount: { id: 'acc-credit' },
  createdBy: { id: 'admin-1' },
  ...overrides,
});

describe('RecurringEntryScheduler', () => {
  let scheduler: RecurringEntryScheduler;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRecurringRepo.find.mockResolvedValue([]);
    mockPeriodRepo.findOne.mockResolvedValue(openPeriod);
    mockCacheService.acquireLock.mockResolvedValue(true);
    mockManager.query.mockResolvedValue(undefined);
    mockManager.findOne.mockResolvedValue(null);
    mockManager.create.mockImplementation(
      (_entity: unknown, data: object) => data,
    );
    mockManager.save.mockImplementation((_entity: unknown, data: any) =>
      Promise.resolve({ id: 'entry-1', ...data }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecurringEntryScheduler,
        {
          provide: getRepositoryToken(RecurringEntry),
          useValue: mockRecurringRepo,
        },
        {
          provide: getRepositoryToken(AccountingPeriod),
          useValue: mockPeriodRepo,
        },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: CacheService, useValue: mockCacheService },
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
      ],
    }).compile();
    scheduler = module.get(RecurringEntryScheduler);
  });

  it('runs the due-entry query once per active tenant, entering each tenant context', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
      { id: 't2', subdomain: 'b', schemaName: 'church_b' },
    ]);

    await scheduler.generateDueEntries();

    expect(mockRecurringRepo.find).toHaveBeenCalledTimes(2);
    expect(mockTxHost.tx.query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_a", public',
    );
    expect(mockTxHost.tx.query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_b", public',
    );
  });

  it('creates a journal entry with matching debit/credit lines for a due recurring entry, inside a savepoint', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);
    mockRecurringRepo.find.mockResolvedValue([dueEntry()]);

    await scheduler.generateDueEntries();

    expect(mockManager.query).toHaveBeenCalledWith(
      expect.stringContaining('SAVEPOINT'),
    );
    expect(mockManager.query).toHaveBeenCalledWith(
      expect.stringContaining('RELEASE SAVEPOINT'),
    );
    expect(mockManager.save).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  it('skips generation entirely when no accounting period is open', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);
    mockRecurringRepo.find.mockResolvedValue([dueEntry()]);
    mockPeriodRepo.findOne.mockResolvedValue(null);

    await scheduler.generateDueEntries();

    expect(mockManager.save).not.toHaveBeenCalled();
  });

  it('rolls back to the savepoint and continues when one entry fails, without aborting the batch', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);
    mockRecurringRepo.find.mockResolvedValue([
      dueEntry({ id: 'recurring-1' }),
      dueEntry({ id: 'recurring-2' }),
    ]);
    mockManager.save
      .mockRejectedValueOnce(new Error('constraint violation'))
      .mockImplementation((_entity: unknown, data: any) =>
        Promise.resolve({ id: 'entry-x', ...data }),
      );

    await expect(scheduler.generateDueEntries()).resolves.toBeUndefined();

    expect(mockManager.query).toHaveBeenCalledWith(
      expect.stringContaining('ROLLBACK TO SAVEPOINT'),
    );
    expect(mockManager.save).toHaveBeenCalled();
  });
});
