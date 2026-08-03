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

@Injectable()
export class PlanGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService<AppClsStore>,
    private readonly cacheService: CacheService,
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

    const features = await this.cacheService.getOrSet(
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
    return true;
  }

  // Whatever endpoint changes a tenant's plan must cacheService.del() this
  // same key (`plan-features:${tenantId}`) — no such endpoint exists yet
  // (self-serve upgrade checkout is deferred, §9 Phase 3), so there's
  // nothing to wire up until one is built.
  private async resolveFeatures(tenantId: string): Promise<string[]> {
    const subscription = await this.subscriptionRepo.findOne({
      where: { tenantId },
    });
    if (!subscription) return [];

    const plan = await this.planRepo.findOne({
      where: { id: subscription.planId },
    });
    return plan?.features ?? [];
  }
}
