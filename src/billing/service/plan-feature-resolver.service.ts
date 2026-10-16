import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plan } from '../entity/plan.entity';
import { Subscription } from '../entity/subscription.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { CacheService } from '../../utility/service/cache.service';

export interface ResolvedPlan {
  features: string[];
  featureLimits: Record<string, number>;
  // Platform-admin manual overrides keyed by module/feature key (Tenant.moduleOverrides); both
  // ModuleEnabledGuard and PlanGuard check them ahead of `features` membership.
  overrides: Record<string, boolean>;
}

// Why a church can't use a feature. The 403 keeps `code: 'PLAN_UPGRADE_REQUIRED'` for every reason (the apps key
// on it to show their gate or hide a section quietly); `reason` says which message is true.
export type FeatureGateReason =
  'NOT_ON_PLAN' | 'NOT_RELEASED' | 'DISABLED_FOR_CHURCH' | 'LIMIT_REACHED';

const GATE_MESSAGE: Record<FeatureGateReason, string> = {
  NOT_ON_PLAN: 'This feature requires an upgraded plan.',
  NOT_RELEASED: "This feature isn't available yet.",
  DISABLED_FOR_CHURCH: 'This feature has been turned off for your church.',
  LIMIT_REACHED: "You've reached this plan's usage limit for this feature.",
};

export function featureGateError(
  feature: string,
  reason: FeatureGateReason,
  message = GATE_MESSAGE[reason],
): ForbiddenException {
  return new ForbiddenException({
    message,
    code: 'PLAN_UPGRADE_REQUIRED',
    reason,
    requiredFeature: feature,
  });
}

// Every feature some plan includes. Clear it whenever a plan's features change.
export const RELEASED_FEATURES_KEY = 'plans:released-features';
const RELEASED_FEATURES_TTL_SECONDS = 300;

// Shared by PlanGuard and ModuleEnabledGuard so a request touching a route
// with both decorators only resolves the tenant's plan once (same cache
// key/TTL either guard would have used on its own).
@Injectable()
export class PlanFeatureResolverService {
  constructor(
    private readonly cacheService: CacheService,
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    @InjectRepository(Plan)
    private readonly planRepo: Repository<Plan>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  async resolve(tenantId: string): Promise<ResolvedPlan> {
    return this.cacheService.getOrSet(
      `plan-features:${tenantId}`,
      () => this.fetchFromDb(tenantId),
      300,
    );
  }

  // Null when the church may use the feature; otherwise why not. Overrides win over the plan either way.
  async gateReason(
    tenantId: string,
    feature: string,
  ): Promise<FeatureGateReason | null> {
    const { features, overrides } = await this.resolve(tenantId);
    const override = overrides[feature];
    if (override === false) return 'DISABLED_FOR_CHURCH';
    if (override === true || features.includes(feature)) return null;
    return (await this.releasedFeatures()).includes(feature)
      ? 'NOT_ON_PLAN'
      : 'NOT_RELEASED';
  }

  async assertEntitled(
    tenantId: string,
    feature: string,
    notOnPlanMessage?: string,
  ): Promise<void> {
    const reason = await this.gateReason(tenantId, feature);
    if (!reason) return;
    throw featureGateError(
      feature,
      reason,
      reason === 'NOT_ON_PLAN' ? notOnPlanMessage : undefined,
    );
  }

  private async releasedFeatures(): Promise<string[]> {
    const cached = await this.cacheService
      .getGlobal<string[]>(RELEASED_FEATURES_KEY)
      .catch(() => undefined);
    if (cached) return cached;
    const plans = await this.planRepo.find({
      select: { id: true, features: true },
    });
    const released = [...new Set(plans.flatMap((p) => p.features))];
    this.cacheService
      .setGlobal(RELEASED_FEATURES_KEY, released, RELEASED_FEATURES_TTL_SECONDS)
      .catch(() => undefined);
    return released;
  }

  private async fetchFromDb(tenantId: string): Promise<ResolvedPlan> {
    // Fetched regardless of whether a subscription exists — an override
    // must still apply to a tenant with no plan/subscription row at all
    // (e.g. mid-provisioning, or deliberately comped without a real
    // subscription), not just layered on top of an existing plan.
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const overrides = tenant?.moduleOverrides ?? {};

    const subscription = await this.subscriptionRepo.findOne({
      where: { tenantId },
    });
    if (!subscription) return { features: [], featureLimits: {}, overrides };

    const plan = await this.planRepo.findOne({
      where: { id: subscription.planId },
    });
    return {
      features: plan?.features ?? [],
      featureLimits: plan?.featureLimits ?? {},
      overrides,
    };
  }
}
