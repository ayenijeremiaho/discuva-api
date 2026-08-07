import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';

export class CreatePlanDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9_-]+$/, {
    message: 'id must be lowercase letters, numbers, hyphens, underscores',
  })
  id: string;

  @IsString()
  @IsNotEmpty()
  name: string;

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

  // Map of PlanFeature -> max lifetime uses per tenant. Keys/values are
  // deep-validated in PlatformPlanService (a valid PlanFeature per key, a
  // positive integer per value) rather than here — class-validator has no
  // clean built-in for "record of enum to positive int".
  @IsOptional()
  @IsObject()
  featureLimits?: Record<string, number>;
}
