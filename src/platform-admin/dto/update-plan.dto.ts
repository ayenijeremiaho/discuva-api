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
import { SUPPORTED_BILLING_CURRENCIES } from '../../billing/constant/supported-currencies.constant';

export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  tierKey?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

  @IsOptional()
  @IsIn(SUPPORTED_BILLING_CURRENCIES)
  currency?: string;

  @IsOptional()
  @IsArray()
  @IsIn(ALL_CAPABILITY_KEYS, { each: true })
  features?: string[];

  @IsOptional()
  @IsObject()
  featureLimits?: Record<string, number>;
}
