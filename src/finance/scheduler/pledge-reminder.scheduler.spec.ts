import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { PledgeReminderScheduler } from './pledge-reminder.scheduler';
import { PledgeService } from '../service/pledge.service';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { UtilityService } from '../../utility/service/utility.service';
import { CacheService } from '../../utility/service/cache.service';
import { PledgeFrequency } from '../enum/finance.enum';

const mockPledgeService = { findActivePledgesForReminder: jest.fn() };
const mockTenantRepo = { find: jest.fn() };
const mockUtilityService = {
  sendEmailWithTemplate: jest.fn(),
  capitalizeFirstLetter: jest.fn((s: string) => s),
};
const mockCacheService = {
  acquireLock: jest.fn().mockResolvedValue(true),
  releaseLock: jest.fn(),
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn(),
};
const mockConfigService = {
  get: jest.fn().mockReturnValue('https://login.example.com'),
};
const mockCls = {
  runWith: jest.fn((_store: unknown, fn: () => unknown) => fn()),
};
const mockTxHost = {
  tx: { query: jest.fn() },
  withTransaction: jest.fn((fn: () => unknown) => fn()),
};

describe('PledgeReminderScheduler', () => {
  let scheduler: PledgeReminderScheduler;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPledgeService.findActivePledgesForReminder.mockResolvedValue([]);
    mockCacheService.acquireLock.mockResolvedValue(true);
    mockCacheService.get.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PledgeReminderScheduler,
        { provide: PledgeService, useValue: mockPledgeService },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: UtilityService, useValue: mockUtilityService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
      ],
    }).compile();
    scheduler = module.get(PledgeReminderScheduler);
  });

  it('runs the pledge query once per active tenant, entering each tenant context', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
      { id: 't2', subdomain: 'b', schemaName: 'church_b' },
    ]);

    await scheduler.dispatchPledgeReminders();

    expect(
      mockPledgeService.findActivePledgesForReminder,
    ).toHaveBeenCalledTimes(2);
    expect(mockTxHost.tx.query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_a", public',
    );
    expect(mockTxHost.tx.query).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "church_b", public',
    );
  });

  it('sends a due-today reminder for a pledge due today', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const pledge = {
      id: 'pledge-1',
      startDate,
      frequency: PledgeFrequency.ONE_OFF,
      totalAmount: 5000,
      member: { email: 'w@example.com', firstname: 'Ada' },
      campaign: { name: 'Building Fund' },
    };
    mockPledgeService.findActivePledgesForReminder.mockResolvedValue([pledge]);

    await scheduler.dispatchPledgeReminders();

    expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
      'w@example.com',
      expect.stringContaining('Due Today'),
      'pledge-reminder',
      expect.objectContaining({ campaignName: 'Building Fund' }),
      undefined,
      expect.any(String),
    );
  });

  it('continues past one tenant failing so the rest still get processed', async () => {
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
      { id: 't2', subdomain: 'b', schemaName: 'church_b' },
    ]);
    mockPledgeService.findActivePledgesForReminder
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue([]);

    await expect(scheduler.dispatchPledgeReminders()).resolves.toBeUndefined();
    expect(mockPledgeService.findActivePledgesForReminder).toHaveBeenCalled();
    expect(mockCacheService.releaseLock).toHaveBeenCalled();
  });
});
