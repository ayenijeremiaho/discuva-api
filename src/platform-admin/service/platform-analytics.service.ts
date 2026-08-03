import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { Plan } from '../../billing/entity/plan.entity';
import { Subscription } from '../../billing/entity/subscription.entity';
import { SubscriptionStatus } from '../../billing/enum/subscription-status.enum';
import {
  BillingCheckoutSession,
  BillingCheckoutStatus,
  BillingCheckoutType,
} from '../../billing/entity/billing-checkout-session.entity';
import { TenantRollup } from '../../branch/entity/tenant-rollup.entity';
import { CommunicationProvider } from '../entity/communication-provider.entity';
import { TenantCommunicationProviderConfig } from '../entity/tenant-communication-provider-config.entity';
import { AnalyticsPeriod } from '../dto/analytics-trend-query.dto';

export interface PlanCount {
  planId: string;
  planName: string;
  count: number;
}

export interface PlatformOverview {
  totalTenants: number;
  activeTenants: number;
  suspendedTenants: number;
  totalMembersPlatformWide: number;
  subscriptionsByPlan: PlanCount[];
  mrrCents: number;
}

export interface TrendPoint {
  periodLabel: string;
  count: number;
}

export interface GrowthAnalytics {
  period: AnalyticsPeriod;
  signups: TrendPoint[];
  // Snapshot, not a trend — there's no suspension-event log to derive a
  // historical active/suspended split from, only tenants.isActive's current
  // value. Reported here rather than silently omitted.
  currentActiveTenants: number;
  currentSuspendedTenants: number;
}

export interface RevenueTrendPoint {
  periodLabel: string;
  subscriptionRevenueCents: number;
  walletTopupRevenueCents: number;
  totalCents: number;
}

export interface ProviderRevenue {
  provider: string;
  totalCents: number;
}

export interface RevenueAnalytics {
  period: AnalyticsPeriod;
  mrrCents: number;
  revenueByProvider: ProviderRevenue[];
  trend: RevenueTrendPoint[];
}

export interface EngagementAnalytics {
  totalMembers: number;
  averageAttendanceRate: number | null;
  totalGiving: number;
  tenantsWithRollup: number;
  tenantsMissingRollup: number;
  oldestComputedAt: Date | null;
  newestComputedAt: Date | null;
}

export interface ChurnTrendPoint {
  periodLabel: string;
  canceledCount: number;
}

export interface ChurnAnalytics {
  period: AnalyticsPeriod;
  currentlyCanceled: number;
  currentlyPastDue: number;
  trend: ChurnTrendPoint[];
}

export interface ChannelAdoption {
  byokCount: number;
  totalTenants: number;
  ratePercent: number;
}

export interface AdoptionAnalytics {
  smsAdoption: ChannelAdoption;
  emailAdoption: ChannelAdoption;
  planDistribution: PlanCount[];
}

// Deliberately no new aggregation table/cron — every method here is a live
// query over data that's already computed and small (one row per tenant in
// tenant_rollups/subscriptions, one row per checkout in
// billing_checkout_sessions). At any realistic tenant count this is cheap;
// revisit only if tenant count genuinely grows large enough to matter
// (docs/MULTI_TENANT_MIGRATION.md §9 Phase 3/§11).
@Injectable()
export class PlatformAnalyticsService {
  constructor(
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Plan) private readonly planRepo: Repository<Plan>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    @InjectRepository(BillingCheckoutSession)
    private readonly checkoutRepo: Repository<BillingCheckoutSession>,
    @InjectRepository(TenantRollup)
    private readonly rollupRepo: Repository<TenantRollup>,
    @InjectRepository(CommunicationProvider)
    private readonly providerRepo: Repository<CommunicationProvider>,
    @InjectRepository(TenantCommunicationProviderConfig)
    private readonly providerConfigRepo: Repository<TenantCommunicationProviderConfig>,
  ) {}

  private periodLabel(date: Date, period: AnalyticsPeriod): string {
    const d = new Date(date);
    if (period === 'daily') {
      return d.toISOString().slice(0, 10);
    }
    if (period === 'weekly') {
      const day = d.getDay();
      const sunday = new Date(d);
      sunday.setDate(d.getDate() - day);
      return sunday.toISOString().slice(0, 10);
    }
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  private monthsAgo(months: number): Date {
    const d = new Date();
    d.setMonth(d.getMonth() - months);
    return d;
  }

  private async planNameMap(): Promise<Map<string, string>> {
    const plans = await this.planRepo.find();
    return new Map(plans.map((p) => [p.id, p.name]));
  }

  // Excludes sponsored subscriptions (a branch riding its parent's plan for
  // free, docs/MULTI_TENANT_MIGRATION.md §11.1) — no real money backs those,
  // so counting them would overstate actual recurring revenue.
  private async mrrCents(): Promise<number> {
    const row = await this.subscriptionRepo
      .createQueryBuilder('sub')
      .innerJoin(Plan, 'plan', 'plan.id = sub.planId')
      .select('COALESCE(SUM(plan.priceCents), 0)', 'total')
      .where('sub.status = :status', { status: SubscriptionStatus.ACTIVE })
      .andWhere('sub.sponsoredByTenantId IS NULL')
      .getRawOne<{ total: string }>();
    return Number.parseInt(row?.total ?? '0', 10);
  }

  async getOverview(): Promise<PlatformOverview> {
    const [
      totalTenants,
      activeTenants,
      membersRow,
      planCounts,
      planNames,
      mrrCents,
    ] = await Promise.all([
      this.tenantRepo.count(),
      this.tenantRepo.count({ where: { isActive: true } }),
      this.rollupRepo
        .createQueryBuilder('r')
        .select('COALESCE(SUM(r.memberCount), 0)', 'total')
        .getRawOne<{ total: string }>(),
      this.subscriptionRepo
        .createQueryBuilder('sub')
        .select('sub.planId', 'planId')
        .addSelect('COUNT(*)', 'count')
        .where('sub.status = :status', { status: SubscriptionStatus.ACTIVE })
        .groupBy('sub.planId')
        .getRawMany<{ planId: string; count: string }>(),
      this.planNameMap(),
      this.mrrCents(),
    ]);

    return {
      totalTenants,
      activeTenants,
      suspendedTenants: totalTenants - activeTenants,
      totalMembersPlatformWide: Number.parseInt(membersRow?.total ?? '0', 10),
      subscriptionsByPlan: planCounts.map((r) => ({
        planId: r.planId,
        planName: planNames.get(r.planId) ?? r.planId,
        count: Number.parseInt(r.count, 10),
      })),
      mrrCents,
    };
  }

  async getGrowth(
    period: AnalyticsPeriod,
    months: number,
  ): Promise<GrowthAnalytics> {
    const [tenants, activeTenants, totalTenants] = await Promise.all([
      this.tenantRepo.find({
        select: ['createdAt'],
        order: { createdAt: 'ASC' },
      }),
      this.tenantRepo.count({ where: { isActive: true } }),
      this.tenantRepo.count(),
    ]);

    const since = this.monthsAgo(months);
    const bucketMap = new Map<string, number>();
    for (const tenant of tenants) {
      if (tenant.createdAt < since) continue;
      const label = this.periodLabel(tenant.createdAt, period);
      bucketMap.set(label, (bucketMap.get(label) ?? 0) + 1);
    }

    const signups = [...bucketMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([periodLabel, count]) => ({ periodLabel, count }));

    return {
      period,
      signups,
      currentActiveTenants: activeTenants,
      currentSuspendedTenants: totalTenants - activeTenants,
    };
  }

  async getRevenue(
    period: AnalyticsPeriod,
    months: number,
  ): Promise<RevenueAnalytics> {
    const since = this.monthsAgo(months);

    const [mrrCents, revenueByProviderRaw, sessions] = await Promise.all([
      this.mrrCents(),
      this.checkoutRepo
        .createQueryBuilder('c')
        .select('c.provider', 'provider')
        .addSelect('COALESCE(SUM(c.amountCents), 0)', 'total')
        .where('c.status = :status', {
          status: BillingCheckoutStatus.COMPLETED,
        })
        .groupBy('c.provider')
        .getRawMany<{ provider: string; total: string }>(),
      this.checkoutRepo.find({
        where: { status: BillingCheckoutStatus.COMPLETED },
        order: { completedAt: 'ASC' },
      }),
    ]);

    const bucketMap = new Map<
      string,
      { subscriptionRevenueCents: number; walletTopupRevenueCents: number }
    >();
    for (const session of sessions) {
      if (!session.completedAt || session.completedAt < since) continue;
      const label = this.periodLabel(session.completedAt, period);
      const bucket = bucketMap.get(label) ?? {
        subscriptionRevenueCents: 0,
        walletTopupRevenueCents: 0,
      };
      if (session.type === BillingCheckoutType.SUBSCRIPTION) {
        bucket.subscriptionRevenueCents += session.amountCents;
      } else {
        bucket.walletTopupRevenueCents += session.amountCents;
      }
      bucketMap.set(label, bucket);
    }

    const trend = [...bucketMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([periodLabel, b]) => ({
        periodLabel,
        subscriptionRevenueCents: b.subscriptionRevenueCents,
        walletTopupRevenueCents: b.walletTopupRevenueCents,
        totalCents: b.subscriptionRevenueCents + b.walletTopupRevenueCents,
      }));

    return {
      period,
      mrrCents,
      revenueByProvider: revenueByProviderRaw.map((r) => ({
        provider: r.provider,
        totalCents: Number.parseInt(r.total, 10),
      })),
      trend,
    };
  }

  async getEngagement(): Promise<EngagementAnalytics> {
    const [rollups, totalTenants] = await Promise.all([
      this.rollupRepo.find(),
      this.tenantRepo.count(),
    ]);

    const totalMembers = rollups.reduce((sum, r) => sum + r.memberCount, 0);
    const totalGiving = rollups.reduce(
      (sum, r) => sum + (Number(r.totalGiving) || 0),
      0,
    );
    const rates = rollups
      .map((r) => (r.attendanceRate === null ? null : Number(r.attendanceRate)))
      .filter((r): r is number => r !== null);
    const averageAttendanceRate =
      rates.length === 0
        ? null
        : Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100) /
          100;

    const computedDates = rollups.map((r) => r.computedAt).sort();

    return {
      totalMembers,
      averageAttendanceRate,
      totalGiving,
      tenantsWithRollup: rollups.length,
      tenantsMissingRollup: totalTenants - rollups.length,
      oldestComputedAt: computedDates[0] ?? null,
      newestComputedAt: computedDates[computedDates.length - 1] ?? null,
    };
  }

  async getChurn(
    period: AnalyticsPeriod,
    months: number,
  ): Promise<ChurnAnalytics> {
    const [currentlyCanceled, currentlyPastDue, canceledSubs] =
      await Promise.all([
        this.subscriptionRepo.count({
          where: { status: SubscriptionStatus.CANCELED },
        }),
        this.subscriptionRepo.count({
          where: { status: SubscriptionStatus.PAST_DUE },
        }),
        this.subscriptionRepo.find({
          where: { status: SubscriptionStatus.CANCELED },
          order: { canceledAt: 'ASC' },
        }),
      ]);

    const since = this.monthsAgo(months);
    const bucketMap = new Map<string, number>();
    for (const sub of canceledSubs) {
      if (!sub.canceledAt || sub.canceledAt < since) continue;
      const label = this.periodLabel(sub.canceledAt, period);
      bucketMap.set(label, (bucketMap.get(label) ?? 0) + 1);
    }

    const trend = [...bucketMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([periodLabel, canceledCount]) => ({ periodLabel, canceledCount }));

    return { period, currentlyCanceled, currentlyPastDue, trend };
  }

  private async channelAdoption(
    channel: 'sms' | 'email',
    totalTenants: number,
  ): Promise<ChannelAdoption> {
    const row = await this.providerConfigRepo
      .createQueryBuilder('config')
      .innerJoin(
        CommunicationProvider,
        'provider',
        'provider.id = config.providerId',
      )
      .select('COUNT(DISTINCT config.tenantId)', 'count')
      .where('config.isActive = true')
      .andWhere('provider.channel = :channel', { channel })
      .getRawOne<{ count: string }>();

    const byokCount = Number.parseInt(row?.count ?? '0', 10);
    return {
      byokCount,
      totalTenants,
      ratePercent:
        totalTenants === 0
          ? 0
          : Math.round((byokCount / totalTenants) * 10000) / 100,
    };
  }

  async getAdoption(): Promise<AdoptionAnalytics> {
    const totalTenants = await this.tenantRepo.count();

    const [smsAdoption, emailAdoption, planCounts, planNames] =
      await Promise.all([
        this.channelAdoption('sms', totalTenants),
        this.channelAdoption('email', totalTenants),
        this.subscriptionRepo
          .createQueryBuilder('sub')
          .select('sub.planId', 'planId')
          .addSelect('COUNT(*)', 'count')
          .groupBy('sub.planId')
          .getRawMany<{ planId: string; count: string }>(),
        this.planNameMap(),
      ]);

    return {
      smsAdoption,
      emailAdoption,
      planDistribution: planCounts.map((r) => ({
        planId: r.planId,
        planName: planNames.get(r.planId) ?? r.planId,
        count: Number.parseInt(r.count, 10),
      })),
    };
  }
}
