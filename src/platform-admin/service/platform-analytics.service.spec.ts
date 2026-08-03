import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PlatformAnalyticsService } from './platform-analytics.service';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { Plan } from '../../billing/entity/plan.entity';
import { Subscription } from '../../billing/entity/subscription.entity';
import { SubscriptionStatus } from '../../billing/enum/subscription-status.enum';
import { BillingCheckoutSession } from '../../billing/entity/billing-checkout-session.entity';
import { TenantRollup } from '../../branch/entity/tenant-rollup.entity';
import { CommunicationProvider } from '../entity/communication-provider.entity';
import { TenantCommunicationProviderConfig } from '../entity/tenant-communication-provider-config.entity';

function mockQB(raw: any) {
  return {
    innerJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue(Array.isArray(raw) ? raw[0] : raw),
    getRawMany: jest.fn().mockResolvedValue(Array.isArray(raw) ? raw : [raw]),
  };
}

const mockTenantRepo = { count: jest.fn(), find: jest.fn() };
const mockPlanRepo = { find: jest.fn() };
const mockSubscriptionRepo = {
  count: jest.fn(),
  find: jest.fn(),
  createQueryBuilder: jest.fn(),
};
const mockCheckoutRepo = { find: jest.fn(), createQueryBuilder: jest.fn() };
const mockRollupRepo = { find: jest.fn(), createQueryBuilder: jest.fn() };
const mockProviderRepo = {};
const mockProviderConfigRepo = { createQueryBuilder: jest.fn() };

describe('PlatformAnalyticsService', () => {
  let service: PlatformAnalyticsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformAnalyticsService,
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: getRepositoryToken(Plan), useValue: mockPlanRepo },
        {
          provide: getRepositoryToken(Subscription),
          useValue: mockSubscriptionRepo,
        },
        {
          provide: getRepositoryToken(BillingCheckoutSession),
          useValue: mockCheckoutRepo,
        },
        { provide: getRepositoryToken(TenantRollup), useValue: mockRollupRepo },
        {
          provide: getRepositoryToken(CommunicationProvider),
          useValue: mockProviderRepo,
        },
        {
          provide: getRepositoryToken(TenantCommunicationProviderConfig),
          useValue: mockProviderConfigRepo,
        },
      ],
    }).compile();
    service = module.get(PlatformAnalyticsService);
  });

  describe('getOverview', () => {
    it('aggregates tenant counts, members, plan distribution, and MRR', async () => {
      mockTenantRepo.count.mockResolvedValueOnce(10).mockResolvedValueOnce(8);
      mockRollupRepo.createQueryBuilder.mockReturnValue(
        mockQB({ total: '450' }),
      );
      mockSubscriptionRepo.createQueryBuilder
        .mockReturnValueOnce(
          mockQB([
            { planId: 'pro', count: '3' },
            { planId: 'free', count: '5' },
          ]),
        )
        .mockReturnValueOnce(mockQB({ total: '15000' }));
      mockPlanRepo.find.mockResolvedValue([
        { id: 'pro', name: 'Pro' },
        { id: 'free', name: 'Free' },
      ]);

      const result = await service.getOverview();

      expect(result).toEqual({
        totalTenants: 10,
        activeTenants: 8,
        suspendedTenants: 2,
        totalMembersPlatformWide: 450,
        subscriptionsByPlan: [
          { planId: 'pro', planName: 'Pro', count: 3 },
          { planId: 'free', planName: 'Free', count: 5 },
        ],
        mrrCents: 15000,
      });
    });
  });

  describe('getGrowth', () => {
    it('buckets signups by month and reports current active/suspended as a snapshot', async () => {
      mockTenantRepo.find.mockResolvedValue([
        { createdAt: new Date('2026-06-05') },
        { createdAt: new Date('2026-06-20') },
        { createdAt: new Date('2026-07-01') },
      ]);
      mockTenantRepo.count
        .mockResolvedValueOnce(7) // active
        .mockResolvedValueOnce(9); // total

      const result = await service.getGrowth('monthly', 12);

      expect(result.signups).toEqual([
        { periodLabel: '2026-06', count: 2 },
        { periodLabel: '2026-07', count: 1 },
      ]);
      expect(result.currentActiveTenants).toBe(7);
      expect(result.currentSuspendedTenants).toBe(2);
    });

    it('excludes signups older than the requested window', async () => {
      const old = new Date();
      old.setFullYear(old.getFullYear() - 5);
      mockTenantRepo.find.mockResolvedValue([{ createdAt: old }]);
      mockTenantRepo.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

      const result = await service.getGrowth('monthly', 12);
      expect(result.signups).toEqual([]);
    });
  });

  describe('getRevenue', () => {
    it('splits revenue by provider and buckets subscription vs wallet top-up revenue by month', async () => {
      mockSubscriptionRepo.createQueryBuilder.mockReturnValue(
        mockQB({ total: '20000' }),
      );
      mockCheckoutRepo.createQueryBuilder.mockReturnValue(
        mockQB([
          { provider: 'paystack', total: '50000' },
          { provider: 'flutterwave', total: '10000' },
        ]),
      );
      mockCheckoutRepo.find.mockResolvedValue([
        {
          type: 'subscription',
          amountCents: 500000,
          completedAt: new Date('2026-06-10'),
        },
        {
          type: 'wallet_topup',
          amountCents: 100000,
          completedAt: new Date('2026-06-15'),
        },
      ]);

      const result = await service.getRevenue('monthly', 12);

      expect(result.mrrCents).toBe(20000);
      expect(result.revenueByProvider).toEqual([
        { provider: 'paystack', totalCents: 50000 },
        { provider: 'flutterwave', totalCents: 10000 },
      ]);
      expect(result.trend).toEqual([
        {
          periodLabel: '2026-06',
          subscriptionRevenueCents: 500000,
          walletTopupRevenueCents: 100000,
          totalCents: 600000,
        },
      ]);
    });
  });

  describe('getEngagement', () => {
    it('sums members/giving and averages attendance rate across tenants that have a rollup', async () => {
      mockRollupRepo.find.mockResolvedValue([
        {
          memberCount: 100,
          attendanceRate: 80,
          totalGiving: '5000.00',
          computedAt: new Date('2026-08-01'),
        },
        {
          memberCount: 50,
          attendanceRate: null,
          totalGiving: '0.00',
          computedAt: new Date('2026-08-02'),
        },
      ]);
      mockTenantRepo.count.mockResolvedValue(3);

      const result = await service.getEngagement();

      expect(result.totalMembers).toBe(150);
      expect(result.totalGiving).toBe(5000);
      expect(result.averageAttendanceRate).toBe(80); // only the non-null rate counts
      expect(result.tenantsWithRollup).toBe(2);
      expect(result.tenantsMissingRollup).toBe(1);
    });

    it('returns a null average attendance rate when no tenant has one yet', async () => {
      mockRollupRepo.find.mockResolvedValue([
        {
          memberCount: 10,
          attendanceRate: null,
          totalGiving: '0',
          computedAt: new Date(),
        },
      ]);
      mockTenantRepo.count.mockResolvedValue(1);

      const result = await service.getEngagement();
      expect(result.averageAttendanceRate).toBeNull();
    });
  });

  describe('getChurn', () => {
    it('reports current canceled/past_due snapshots and buckets cancellations by month', async () => {
      mockSubscriptionRepo.count
        .mockResolvedValueOnce(4) // canceled
        .mockResolvedValueOnce(2); // past_due
      mockSubscriptionRepo.find.mockResolvedValue([
        { canceledAt: new Date('2026-06-10') },
        { canceledAt: new Date('2026-06-20') },
      ]);

      const result = await service.getChurn('monthly', 12);

      expect(result.currentlyCanceled).toBe(4);
      expect(result.currentlyPastDue).toBe(2);
      expect(result.trend).toEqual([
        { periodLabel: '2026-06', canceledCount: 2 },
      ]);
      expect(mockSubscriptionRepo.count).toHaveBeenCalledWith({
        where: { status: SubscriptionStatus.CANCELED },
      });
    });
  });

  describe('getAdoption', () => {
    it('computes BYOK adoption rate per channel and plan distribution across all subscriptions', async () => {
      mockTenantRepo.count.mockResolvedValue(10);
      mockProviderConfigRepo.createQueryBuilder
        .mockReturnValueOnce(mockQB({ count: '3' })) // sms
        .mockReturnValueOnce(mockQB({ count: '1' })); // email
      mockSubscriptionRepo.createQueryBuilder.mockReturnValue(
        mockQB([
          { planId: 'free', count: '7' },
          { planId: 'pro', count: '3' },
        ]),
      );
      mockPlanRepo.find.mockResolvedValue([
        { id: 'free', name: 'Free' },
        { id: 'pro', name: 'Pro' },
      ]);

      const result = await service.getAdoption();

      expect(result.smsAdoption).toEqual({
        byokCount: 3,
        totalTenants: 10,
        ratePercent: 30,
      });
      expect(result.emailAdoption).toEqual({
        byokCount: 1,
        totalTenants: 10,
        ratePercent: 10,
      });
      expect(result.planDistribution).toEqual([
        { planId: 'free', planName: 'Free', count: 7 },
        { planId: 'pro', planName: 'Pro', count: 3 },
      ]);
    });

    it('reports a zero rate rather than dividing by zero when there are no tenants', async () => {
      mockTenantRepo.count.mockResolvedValue(0);
      mockProviderConfigRepo.createQueryBuilder
        .mockReturnValueOnce(mockQB({ count: '0' }))
        .mockReturnValueOnce(mockQB({ count: '0' }));
      mockSubscriptionRepo.createQueryBuilder.mockReturnValue(mockQB([]));
      mockPlanRepo.find.mockResolvedValue([]);

      const result = await service.getAdoption();
      expect(result.smsAdoption.ratePercent).toBe(0);
    });
  });
});
