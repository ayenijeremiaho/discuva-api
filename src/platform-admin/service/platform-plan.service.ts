import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plan } from '../../billing/entity/plan.entity';
import { Subscription } from '../../billing/entity/subscription.entity';
import { ALL_CAPABILITY_KEYS } from '../../billing/constant/capability-keys.constant';
import { CreatePlanDto } from '../dto/create-plan.dto';
import { UpdatePlanDto } from '../dto/update-plan.dto';
import { CacheService } from '../../utility/service/cache.service';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';

@Injectable()
export class PlatformPlanService {
  constructor(
    @InjectRepository(Plan)
    private readonly planRepo: Repository<Plan>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    private readonly cacheService: CacheService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async listPlans(): Promise<Plan[]> {
    return this.planRepo.find({ order: { priceCents: 'ASC' } });
  }

  async createPlan(dto: CreatePlanDto): Promise<Plan> {
    const existing = await this.planRepo.findOneBy({ id: dto.id });
    if (existing) {
      throw new ConflictException(`Plan "${dto.id}" already exists.`);
    }
    this.validateFeatureLimits(dto.featureLimits);
    return this.planRepo.save(this.planRepo.create(dto));
  }

  async updatePlan(id: string, dto: UpdatePlanDto): Promise<Plan> {
    const plan = await this.planRepo.findOneBy({ id });
    if (!plan) throw new NotFoundException('Plan not found');
    this.validateFeatureLimits(dto.featureLimits);
    // Once a provider-side price object exists it's charging real money at
    // the currency/interval it was created with — silently letting either
    // drift out from under it would desync what the DB says from what
    // actually gets charged/renewed. Create a new plan variant instead.
    const currencyChanged =
      dto.currency !== undefined && dto.currency !== plan.currency;
    const intervalChanged =
      dto.billingInterval !== undefined &&
      dto.billingInterval !== plan.billingInterval;
    if ((currencyChanged || intervalChanged) && plan.billingProviderPriceId) {
      throw new BadRequestException(
        'Cannot change currency or billing interval on a plan that already has a live provider price. Create a new plan variant instead.',
      );
    }
    Object.assign(plan, dto);
    const saved = await this.planRepo.save(plan);

    // PlanFeatureResolverService.resolve() caches per tenant for 300s
    // (plan-features:${tenantId}) — a features/featureLimits change here
    // otherwise wouldn't take effect for any already-cached tenant on this
    // plan until that TTL naturally expires. Same reasoning as
    // PlatformTenantService.invalidateAllTenantCaches() for the module
    // rollout endpoints, scoped here to just this plan's own subscribers.
    //
    // CacheService.del() scopes its key by the tenant id in CLS, which is
    // absent on this platform-admin request (falls back to 'global') — the
    // entry was SET from inside an actual tenant-scoped request, so a bare
    // del() call here would compute the wrong key and silently no-op. See
    // PlatformTenantService.delTenantCache()'s own comment for the full
    // story; re-entering each affected tenant's CLS context is the fix.
    if (dto.features !== undefined || dto.featureLimits !== undefined) {
      const subscriptions = await this.subscriptionRepo.find({
        where: { planId: id },
      });
      await Promise.all(
        subscriptions.map((s) =>
          this.cls.runWith({ tenantId: s.tenantId } as AppClsStore, () =>
            this.cacheService.del(`plan-features:${s.tenantId}`),
          ),
        ),
      );
    }

    return saved;
  }

  // class-validator's @IsObject() on the DTO only confirms it's an object —
  // key/value shape (a real capability key per key, a positive integer per
  // value) is checked here since there's no clean declarative validator
  // for that shape.
  private validateFeatureLimits(featureLimits?: Record<string, number>) {
    if (!featureLimits) return;
    const validFeatures = new Set<string>(ALL_CAPABILITY_KEYS);
    for (const [feature, limit] of Object.entries(featureLimits)) {
      if (!validFeatures.has(feature)) {
        throw new BadRequestException(
          `"${feature}" is not a known plan feature.`,
        );
      }
      if (!Number.isInteger(limit) || limit <= 0) {
        throw new BadRequestException(
          `featureLimits["${feature}"] must be a positive integer.`,
        );
      }
    }
  }

  async listSubscriptions(): Promise<Subscription[]> {
    return this.subscriptionRepo.find({ order: { createdAt: 'DESC' } });
  }
}
