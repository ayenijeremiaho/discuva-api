import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ALL_CAPABILITY_KEYS } from '../../billing/constant/capability-keys.constant';

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
  @IsIn(ALL_CAPABILITY_KEYS, { each: true })
  features?: string[];

  @IsOptional()
  @IsObject()
  featureLimits?: Record<string, number>;
}
