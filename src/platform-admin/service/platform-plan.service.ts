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
import { PlanFeature } from '../../billing/enum/plan-feature.enum';
import { CreatePlanDto } from '../dto/create-plan.dto';
import { UpdatePlanDto } from '../dto/update-plan.dto';

@Injectable()
export class PlatformPlanService {
  constructor(
    @InjectRepository(Plan)
    private readonly planRepo: Repository<Plan>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
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
    Object.assign(plan, dto);
    return this.planRepo.save(plan);
  }

  // class-validator's @IsObject() on the DTO only confirms it's an object —
  // key/value shape (a real PlanFeature per key, a positive integer per
  // value) is checked here since there's no clean declarative validator
  // for that shape.
  private validateFeatureLimits(featureLimits?: Record<string, number>) {
    if (!featureLimits) return;
    const validFeatures = new Set<string>(Object.values(PlanFeature));
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
