import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { PlanFeature } from '../enum/plan-feature.enum';
import { REQUIRES_PLAN_KEY } from '../decorator/requires-plan.decorator';
import { COUNTS_TOWARD_LIMIT_KEY } from '../decorator/counts-toward-limit.decorator';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { FeatureUsageService } from '../service/feature-usage.service';
import { PlanFeatureResolverService } from '../service/plan-feature-resolver.service';

@Injectable()
export class PlanGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService<AppClsStore>,
    private readonly planFeatureResolver: PlanFeatureResolverService,
    private readonly featureUsageService: FeatureUsageService,
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

    // Whatever endpoint changes a tenant's plan must cacheService.del() this
    // same key (`plan-features:${tenantId}`) — PlatformTenantService.changeTenantPlan
    // (manual platform-admin override) already does this; self-serve upgrade
    // checkout is still deferred (§9 Phase 3) and will need the same call.
    const { features, featureLimits } =
      await this.planFeatureResolver.resolve(tenantId);

    if (!features.includes(required)) {
      throw new ForbiddenException({
        message: 'This feature requires an upgraded plan.',
        code: 'PLAN_UPGRADE_REQUIRED',
        requiredFeature: required,
      });
    }

    // Numeric cap is opt-in per plan (Plan.featureLimits, admin-configurable
    // — see plan.entity.ts) layered on top of the boolean feature gate
    // above, and further opt-in per ROUTE via @CountsTowardLimit — most
    // routes sharing this controller's class-level @RequiresPlan (list,
    // read, poll, join...) never consume a use, only the one(s) explicitly
    // marked. This is a read-only pre-check; the actual increment happens
    // in PlanLimitInterceptor, only after the handler succeeds, so a
    // request that later 4xxs for an unrelated reason never spends a use.
    const countsToward = this.reflector.getAllAndOverride<PlanFeature>(
      COUNTS_TOWARD_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    const limit = featureLimits[required];
    if (countsToward && limit != null) {
      const used = await this.featureUsageService.getUsage(tenantId, required);
      if (used >= limit) {
        throw new ForbiddenException({
          message: `You've reached this plan's usage limit for this feature.`,
          code: 'PLAN_UPGRADE_REQUIRED',
          requiredFeature: required,
        });
      }
    }

    return true;
  }
}
