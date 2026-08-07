import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';

export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsArray()
  @IsIn(Object.values(PlanFeature), { each: true })
  features?: PlanFeature[];

  @IsOptional()
  @IsObject()
  featureLimits?: Record<string, number>;
}
