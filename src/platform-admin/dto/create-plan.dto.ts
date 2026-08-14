import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { ALL_CAPABILITY_KEYS } from '../../billing/constant/capability-keys.constant';
import { SUPPORTED_BILLING_CURRENCIES } from '../../billing/constant/supported-currencies.constant';
import { BillingInterval } from '../../billing/enum/billing-interval.enum';

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

  // Groups this row with other currency variants of the same conceptual
  // tier (e.g. 'pro' and 'pro-usd' both use tierKey 'pro') — display/grouping
  // only, never read by checkout/guard logic.
  @IsString()
  @IsNotEmpty()
  tierKey: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

  @IsOptional()
  @IsIn(SUPPORTED_BILLING_CURRENCIES)
  currency?: string;

  // Second variant dimension alongside currency — required, matching
  // tierKey, since every plan row must declare which cadence it bills at.
  @IsEnum(BillingInterval)
  billingInterval: BillingInterval;

  @IsOptional()
  @IsArray()
  @IsIn(ALL_CAPABILITY_KEYS, { each: true })
  features?: string[];

  // Map of PlanFeature -> max lifetime uses per tenant. Keys/values are
  // deep-validated in PlatformPlanService (a valid PlanFeature per key, a
  // positive integer per value) rather than here — class-validator has no
  // clean built-in for "record of enum to positive int".
  @IsOptional()
  @IsObject()
  featureLimits?: Record<string, number>;
}
