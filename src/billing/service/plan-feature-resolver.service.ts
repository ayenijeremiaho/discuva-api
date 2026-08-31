import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plan } from '../entity/plan.entity';
import { Subscription } from '../entity/subscription.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { CacheService } from '../../utility/service/cache.service';

export interface ResolvedPlan {
  features: string[];
  featureLimits: Record<string, number>;
  // Platform-admin manual overrides, keyed by module/feature key — see
  // Tenant.moduleOverrides' own comment. Checked by ModuleEnabledGuard
  // ahead of `features` membership; PlanGuard doesn't consult this (no
  // per-tenant override need has come up for the orphan PlanFeature-only
  // gates yet).
  overrides: Record<string, boolean>;
}

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
