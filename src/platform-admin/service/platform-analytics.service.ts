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
import { DiscountType } from '../../billing/enum/discount-type.enum';
import { computeEffectivePriceCents } from '../../billing/util/discount.util';
import { CommunicationProvider } from '../entity/communication-provider.entity';
import { TenantCommunicationProviderConfig } from '../entity/tenant-communication-provider-config.entity';
import { TenantGivingProviderConfig } from '../../giving-checkout/entity/tenant-giving-provider-config.entity';
import {
  GivingCheckoutSession,
  GivingCheckoutStatus,
} from '../../giving-checkout/entity/giving-checkout-session.entity';
import { AnalyticsPeriod } from '../dto/analytics-trend-query.dto';

export interface PlanCount {
  planId: string;
  planName: string;
  count: number;
}

// Amounts are never blended across currencies — same reasoning as
// GivingAmountByCurrency below (a plan priced in NGN summed against one
// priced in USD would be a meaningless number).
export interface MrrByCurrency {
  currency: string;
  mrrCents: number;
}

export interface PlatformOverview {
  totalTenants: number;
  activeTenants: number;
  suspendedTenants: number;
  totalMembersPlatformWide: number;
  subscriptionsByPlan: PlanCount[];
  mrrByCurrency: MrrByCurrency[];
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
  totalCents: number;
}

export interface ProviderRevenue {
  provider: string;
  totalCents: number;
}

export interface RevenueAnalytics {
  period: AnalyticsPeriod;
  mrrByCurrency: MrrByCurrency[];
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
  givingAdoption: ChannelAdoption;
  planDistribution: PlanCount[];
}

// Amounts are deliberately never blended across currencies (a tenant on
// Stripe giving in USD summed against one on Paystack giving in NGN would
// be a meaningless number) — every breakdown below is grouped by currency
// alongside whatever else it's grouped by, never just a single top-level
// total.
export interface GivingAmountByCurrency {
  currency: string;
  totalAmountCents: number;
  count: number;
}

export interface GivingByProvider extends GivingAmountByCurrency {
  provider: string;
}

export interface GivingByTenant extends GivingAmountByCurrency {
  tenantId: string;
  tenantName: string;
  provider: string;
}

export interface GivingTrendPoint extends GivingAmountByCurrency {
  periodLabel: string;
}

export interface GivingAnalytics {
  period: AnalyticsPeriod;
  // All-time (not window-limited by `months`) — the trend below is the
  // windowed breakdown, same split as getRevenue's mrrByCurrency (all-time
  // snapshot) vs. trend (windowed).
  totals: GivingAmountByCurrency[];
  byProvider: GivingByProvider[];
  byTenant: GivingByTenant[];
  trend: GivingTrendPoint[];
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
    @InjectRepository(TenantGivingProviderConfig)
    private readonly givingProviderConfigRepo: Repository<TenantGivingProviderConfig>,
    @InjectRepository(GivingCheckoutSession)
    private readonly givingCheckoutRepo: Repository<GivingCheckoutSession>,
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
  // so counting them would overstate actual recurring revenue. Internal
  // comps (Subscription.discountType) aren't excluded the same way — some
  // real money may still be flowing — so each row's effective (discounted)
  // price is summed in JS via the same computeEffectivePriceCents helper
  // CheckoutService's billing summary uses, rather than a raw SQL SUM.
  private async mrrByCurrency(): Promise<MrrByCurrency[]> {
    const rows = await this.subscriptionRepo
      .createQueryBuilder('sub')
      .innerJoin(Plan, 'plan', 'plan.id = sub.planId')
      .select('plan.priceCents', 'priceCents')
      .addSelect('plan.currency', 'currency')
      .addSelect('sub.discountType', 'discountType')
      .addSelect('sub.discountValue', 'discountValue')
      .addSelect('sub.discountExpiresAt', 'discountExpiresAt')
      .where('sub.status = :status', { status: SubscriptionStatus.ACTIVE })
      .andWhere('sub.sponsoredByTenantId IS NULL')
      .getRawMany<{
        priceCents: number;
        currency: string;
        discountType: DiscountType | null;
        discountValue: number | null;
        discountExpiresAt: Date | null;
      }>();

    const bucketMap = new Map<string, number>();
    for (const row of rows) {
      const effective = computeEffectivePriceCents(Number(row.priceCents), {
        discountType: row.discountType,
        discountValue:
          row.discountValue == null ? null : Number(row.discountValue),
        discountExpiresAt: row.discountExpiresAt,
      });
      bucketMap.set(
        row.currency,
        (bucketMap.get(row.currency) ?? 0) + effective,
      );
    }

    return [...bucketMap.entries()].map(([currency, mrrCents]) => ({
      currency,
      mrrCents,
    }));
  }

  async getOverview(): Promise<PlatformOverview> {
    const [
      totalTenants,
      activeTenants,
      membersRow,
      planCounts,
      planNames,
      mrrByCurrency,
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
      this.mrrByCurrency(),
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
      mrrByCurrency,
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

    const [mrrByCurrency, revenueByProviderRaw, sessions] = await Promise.all([
      this.mrrByCurrency(),
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

    const bucketMap = new Map<string, { subscriptionRevenueCents: number }>();
    for (const session of sessions) {
      if (!session.completedAt || session.completedAt < since) continue;
      if (session.type !== BillingCheckoutType.SUBSCRIPTION) continue;
      const label = this.periodLabel(session.completedAt, period);
      const bucket = bucketMap.get(label) ?? { subscriptionRevenueCents: 0 };
      bucket.subscriptionRevenueCents += session.amountCents;
      bucketMap.set(label, bucket);
    }

    const trend = [...bucketMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([periodLabel, b]) => ({
        periodLabel,
        subscriptionRevenueCents: b.subscriptionRevenueCents,
        totalCents: b.subscriptionRevenueCents,
      }));

    return {
      period,
      mrrByCurrency,
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

  private async givingAdoption(totalTenants: number): Promise<ChannelAdoption> {
    // No `channel` column to filter on here (unlike communication
    // providers) — giving-checkout only ever has the one implicit channel.
    const row = await this.givingProviderConfigRepo
      .createQueryBuilder('config')
      .select('COUNT(DISTINCT config.tenantId)', 'count')
      .where('config.isActive = true')
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

    const [smsAdoption, emailAdoption, givingAdoption, planCounts, planNames] =
      await Promise.all([
        this.channelAdoption('sms', totalTenants),
        this.channelAdoption('email', totalTenants),
        this.givingAdoption(totalTenants),
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
      givingAdoption,
      planDistribution: planCounts.map((r) => ({
        planId: r.planId,
        planName: planNames.get(r.planId) ?? r.planId,
        count: Number.parseInt(r.count, 10),
      })),
    };
  }

  // "Full overview" for platform support — total giving-checkout volume
  // across every tenant, split by provider and by tenant, never blended
  // across currencies. Deliberately a live query over
  // giving_checkout_sessions (same "no new aggregation table" reasoning as
  // the rest of this service) — completed sessions only, everything else
  // (pending/failed) never represents money that actually moved.
  async getGiving(
    period: AnalyticsPeriod,
    months: number,
  ): Promise<GivingAnalytics> {
    const since = this.monthsAgo(months);

    const [totalsRaw, byProviderRaw, byTenantRaw, sessions] = await Promise.all(
      [
        this.givingCheckoutRepo
          .createQueryBuilder('s')
          .select('s.currency', 'currency')
          .addSelect('COALESCE(SUM(s.amountCents), 0)', 'total')
          .addSelect('COUNT(*)', 'count')
          .where('s.status = :status', {
            status: GivingCheckoutStatus.COMPLETED,
          })
          .groupBy('s.currency')
          .getRawMany<{ currency: string; total: string; count: string }>(),
        this.givingCheckoutRepo
          .createQueryBuilder('s')
          .select('s.provider', 'provider')
          .addSelect('s.currency', 'currency')
          .addSelect('COALESCE(SUM(s.amountCents), 0)', 'total')
          .addSelect('COUNT(*)', 'count')
          .where('s.status = :status', {
            status: GivingCheckoutStatus.COMPLETED,
          })
          .groupBy('s.provider')
          .addGroupBy('s.currency')
          .getRawMany<{
            provider: string;
            currency: string;
            total: string;
            count: string;
          }>(),
        this.givingCheckoutRepo
          .createQueryBuilder('s')
          .innerJoin(Tenant, 'tenant', 'tenant.id = s.tenantId')
          .select('s.tenantId', 'tenantId')
          .addSelect('tenant.name', 'tenantName')
          .addSelect('s.provider', 'provider')
          .addSelect('s.currency', 'currency')
          .addSelect('COALESCE(SUM(s.amountCents), 0)', 'total')
          .addSelect('COUNT(*)', 'count')
          .where('s.status = :status', {
            status: GivingCheckoutStatus.COMPLETED,
          })
          .groupBy('s.tenantId')
          .addGroupBy('tenant.name')
          .addGroupBy('s.provider')
          .addGroupBy('s.currency')
          .orderBy('total', 'DESC')
          .getRawMany<{
            tenantId: string;
            tenantName: string;
            provider: string;
            currency: string;
            total: string;
            count: string;
          }>(),
        this.givingCheckoutRepo.find({
          where: { status: GivingCheckoutStatus.COMPLETED },
          order: { completedAt: 'ASC' },
        }),
      ],
    );

    const bucketMap = new Map<
      string,
      Map<string, { totalAmountCents: number; count: number }>
    >();
    for (const session of sessions) {
      if (!session.completedAt || session.completedAt < since) continue;
      const label = this.periodLabel(session.completedAt, period);
      const byCurrency = bucketMap.get(label) ?? new Map();
      const bucket = byCurrency.get(session.currency) ?? {
        totalAmountCents: 0,
        count: 0,
      };
      bucket.totalAmountCents += session.amountCents;
      bucket.count += 1;
      byCurrency.set(session.currency, bucket);
      bucketMap.set(label, byCurrency);
    }

    const trend: GivingTrendPoint[] = [...bucketMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([periodLabel, byCurrency]) =>
        [...byCurrency.entries()].map(([currency, b]) => ({
          periodLabel,
          currency,
          totalAmountCents: b.totalAmountCents,
          count: b.count,
        })),
      );

    return {
      period,
      totals: totalsRaw.map((r) => ({
        currency: r.currency,
        totalAmountCents: Number.parseInt(r.total, 10),
        count: Number.parseInt(r.count, 10),
      })),
      byProvider: byProviderRaw.map((r) => ({
        provider: r.provider,
        currency: r.currency,
        totalAmountCents: Number.parseInt(r.total, 10),
        count: Number.parseInt(r.count, 10),
      })),
      byTenant: byTenantRaw.map((r) => ({
        tenantId: r.tenantId,
        tenantName: r.tenantName,
        provider: r.provider,
        currency: r.currency,
        totalAmountCents: Number.parseInt(r.total, 10),
        count: Number.parseInt(r.count, 10),
      })),
      trend,
    };
  }
}
