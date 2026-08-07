import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { ConfigService } from '@nestjs/config';
import { TransactionHost } from '@nestjs-cls/transactional';
import { SubscriptionLapseScheduler } from './subscription-lapse.scheduler';
import { Subscription } from '../entity/subscription.entity';
import { SubscriptionStatus } from '../enum/subscription-status.enum';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { CacheService } from '../../utility/service/cache.service';
import { EmailQueueService } from '../../utility/service/email-queue.service';

const mockSubscriptionRepo = { find: jest.fn(), save: jest.fn() };
const mockTenantRepo = { findOneBy: jest.fn() };
const mockCacheService = { acquireLock: jest.fn(), del: jest.fn() };
const mockEmailQueueService = { queueEmail: jest.fn() };
const mockCls = { runWith: jest.fn((_store, fn) => fn()) };
const mockTxHost = {
  tx: { query: jest.fn(), findOne: jest.fn() },
  withTransaction: jest.fn((fn) => fn()),
};
const mockConfigService = {
  get: jest.fn((_key: string, defaultValue?: unknown) => defaultValue),
};

describe('SubscriptionLapseScheduler', () => {
  let scheduler: SubscriptionLapseScheduler;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCacheService.acquireLock.mockResolvedValue(true);
    mockCls.runWith.mockImplementation((_store, fn) => fn());
    mockTxHost.withTransaction.mockImplementation((fn) => fn());
    mockTenantRepo.findOneBy.mockResolvedValue({
      id: 'tenant-1',
      schemaName: 'church_test',
    });
    mockTxHost.tx.findOne.mockResolvedValue({
      member: { email: 'admin@example.com' },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionLapseScheduler,
        {
          provide: getRepositoryToken(Subscription),
          useValue: mockSubscriptionRepo,
        },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: CacheService, useValue: mockCacheService },
        { provide: EmailQueueService, useValue: mockEmailQueueService },
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    scheduler = module.get(SubscriptionLapseScheduler);
  });

  it('skips the whole run when another instance holds the lock', async () => {
    mockCacheService.acquireLock.mockResolvedValue(false);
    await scheduler.processLapsedSubscriptions();
    expect(mockSubscriptionRepo.find).not.toHaveBeenCalled();
  });

  it('downgrades a lapsed subscription directly when the tenant requested cancellation', async () => {
    mockSubscriptionRepo.find
      .mockResolvedValueOnce([
        {
          tenantId: 'tenant-1',
          cancelAtPeriodEnd: true,
          currentPeriodEnd: new Date('2026-01-01'),
        },
      ])
      .mockResolvedValueOnce([]); // past-due pass
    mockSubscriptionRepo.save.mockResolvedValue({});

    await scheduler.processLapsedSubscriptions();

    expect(mockSubscriptionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: 'free',
        status: SubscriptionStatus.CANCELED,
        cancelAtPeriodEnd: false,
      }),
    );
    expect(mockCacheService.del).toHaveBeenCalledWith('plan-features:tenant-1');
    expect(mockEmailQueueService.queueEmail).toHaveBeenCalledWith(
      'admin@example.com',
      expect.stringContaining('downgraded'),
      expect.any(String),
    );
  });

  it('flags an unexpected lapse as PAST_DUE and notifies, without downgrading yet', async () => {
    mockSubscriptionRepo.find
      .mockResolvedValueOnce([
        {
          tenantId: 'tenant-1',
          cancelAtPeriodEnd: false,
          currentPeriodEnd: new Date('2026-01-01'),
        },
      ])
      .mockResolvedValueOnce([]);
    mockSubscriptionRepo.save.mockResolvedValue({});

    await scheduler.processLapsedSubscriptions();

    expect(mockSubscriptionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: SubscriptionStatus.PAST_DUE }),
    );
    expect(mockEmailQueueService.queueEmail).toHaveBeenCalledWith(
      'admin@example.com',
      expect.stringContaining('could not confirm'),
      expect.any(String),
    );
  });

  it('leaves a past-due subscription alone while still inside the grace period', async () => {
    const recentPeriodEnd = new Date();
    recentPeriodEnd.setDate(recentPeriodEnd.getDate() - 2); // 2 days ago, grace is 7
    mockSubscriptionRepo.find
      .mockResolvedValueOnce([]) // no newly-lapsed
      .mockResolvedValueOnce([
        { tenantId: 'tenant-1', currentPeriodEnd: recentPeriodEnd },
      ]);

    await scheduler.processLapsedSubscriptions();
    expect(mockSubscriptionRepo.save).not.toHaveBeenCalled();
  });

  it('downgrades a past-due subscription once the grace period has expired', async () => {
    const oldPeriodEnd = new Date();
    oldPeriodEnd.setDate(oldPeriodEnd.getDate() - 10); // 10 days ago, grace is 7
    mockSubscriptionRepo.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { tenantId: 'tenant-1', currentPeriodEnd: oldPeriodEnd },
      ]);
    mockSubscriptionRepo.save.mockResolvedValue({});

    await scheduler.processLapsedSubscriptions();

    expect(mockSubscriptionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: 'free',
        status: SubscriptionStatus.CANCELED,
      }),
    );
  });

  it('honors a configured GRACE_PERIOD_DAYS override instead of the hardcoded default', async () => {
    mockConfigService.get.mockImplementation((key: string) =>
      key === 'GRACE_PERIOD_DAYS' ? 3 : undefined,
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionLapseScheduler,
        {
          provide: getRepositoryToken(Subscription),
          useValue: mockSubscriptionRepo,
        },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: CacheService, useValue: mockCacheService },
        { provide: EmailQueueService, useValue: mockEmailQueueService },
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    const overriddenScheduler = module.get(SubscriptionLapseScheduler);

    const fourDaysAgo = new Date();
    fourDaysAgo.setDate(fourDaysAgo.getDate() - 4); // past the 3-day override
    mockSubscriptionRepo.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { tenantId: 'tenant-1', currentPeriodEnd: fourDaysAgo },
      ]);
    mockSubscriptionRepo.save.mockResolvedValue({});

    await overriddenScheduler.processLapsedSubscriptions();

    expect(mockSubscriptionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: SubscriptionStatus.CANCELED }),
    );
  });

  it('continues past one failure so other subscriptions still get processed', async () => {
    mockSubscriptionRepo.find
      .mockResolvedValueOnce([
        {
          tenantId: 'tenant-1',
          cancelAtPeriodEnd: true,
          currentPeriodEnd: new Date(),
        },
        {
          tenantId: 'tenant-2',
          cancelAtPeriodEnd: true,
          currentPeriodEnd: new Date(),
        },
      ])
      .mockResolvedValueOnce([]);
    mockSubscriptionRepo.save
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({});

    await expect(
      scheduler.processLapsedSubscriptions(),
    ).resolves.toBeUndefined();
    expect(mockSubscriptionRepo.save).toHaveBeenCalledTimes(2);
  });
});
