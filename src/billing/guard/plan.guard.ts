import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { Plan } from '../entity/plan.entity';
import { Subscription } from '../entity/subscription.entity';
import { PlanFeature } from '../enum/plan-feature.enum';
import { REQUIRES_PLAN_KEY } from '../decorator/requires-plan.decorator';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { CacheService } from '../../utility/service/cache.service';
import { FeatureUsageService } from '../service/feature-usage.service';

interface ResolvedPlan {
  features: string[];
  featureLimits: Record<string, number>;
}

@Injectable()
export class PlanGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService<AppClsStore>,
    private readonly cacheService: CacheService,
    private readonly featureUsageService: FeatureUsageService,
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    @InjectRepository(Plan)
    private readonly planRepo: Repository<Plan>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PlanFeature>(
      REQUIRES_PLAN_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const tenantId = this.cls.get('tenantId');
    // TenantMiddleware (§9 Phase 8) sets this for every tenant-scoped
    // request, so in practice this only stays unset on routes excluded
    // from it entirely (platform-admin, signup, health) — none of which
    // carry @RequiresPlan anyway. Kept as a defensive fallback rather than
    // an assumed-active bypass.
    if (!tenantId) return true;

    const { features, featureLimits } = await this.cacheService.getOrSet(
      `plan-features:${tenantId}`,
      () => this.resolveFeatures(tenantId),
      300,
    );

    if (!features.includes(required)) {
      throw new ForbiddenException({
        message: 'This feature requires an upgraded plan.',
        code: 'PLAN_UPGRADE_REQUIRED',
        requiredFeature: required,
      });
    }

    // Numeric cap is opt-in per plan (Plan.featureLimits, admin-configurable
    // — see plan.entity.ts) layered on top of the boolean feature gate
    // above. Consumed here, before the handler runs, rather than after it
    // succeeds — the simplest mechanism that works for every @RequiresPlan
    // route with zero per-feature integration work, at the accepted cost of
    // occasionally spending a use on a request that later 4xxs for an
    // unrelated reason (e.g. a validation failure inside the handler).
    const limit = featureLimits[required];
    if (limit != null) {
      const consumed = await this.featureUsageService.tryConsume(
        tenantId,
        required,
        limit,
      );
      if (!consumed) {
        throw new ForbiddenException({
          message: `You've reached this plan's usage limit for this feature.`,
          code: 'PLAN_UPGRADE_REQUIRED',
          requiredFeature: required,
        });
      }
    }

    return true;
  }

  // Whatever endpoint changes a tenant's plan must cacheService.del() this
  // same key (`plan-features:${tenantId}`) — PlatformTenantService.changeTenantPlan
  // (manual platform-admin override) already does this; self-serve upgrade
  // checkout is still deferred (§9 Phase 3) and will need the same call.
  private async resolveFeatures(tenantId: string): Promise<ResolvedPlan> {
    const subscription = await this.subscriptionRepo.findOne({
      where: { tenantId },
    });
    if (!subscription) return { features: [], featureLimits: {} };

    const plan = await this.planRepo.findOne({
      where: { id: subscription.planId },
    });
    return {
      features: plan?.features ?? [],
      featureLimits: plan?.featureLimits ?? {},
    };
  }
}
