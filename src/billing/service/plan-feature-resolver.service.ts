import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plan } from '../entity/plan.entity';
import { Subscription } from '../entity/subscription.entity';
import { CacheService } from '../../utility/service/cache.service';

export interface ResolvedPlan {
  features: string[];
  featureLimits: Record<string, number>;
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
  ) {}

  async resolve(tenantId: string): Promise<ResolvedPlan> {
    return this.cacheService.getOrSet(
      `plan-features:${tenantId}`,
      () => this.fetchFromDb(tenantId),
      300,
    );
  }

  private async fetchFromDb(tenantId: string): Promise<ResolvedPlan> {
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
