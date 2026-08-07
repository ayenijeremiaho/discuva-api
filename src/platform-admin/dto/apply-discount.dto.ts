import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';
import { DiscountType } from '../../billing/enum/discount-type.enum';

export class ApplyDiscountDto {
  @IsEnum(DiscountType)
  discountType: DiscountType;

  // Percentage (1-100) for PERCENTAGE, cents for FIXED_AMOUNT — the upper
  // bound on PERCENTAGE is enforced in PlatformTenantService, not here,
  // since it depends on discountType.
  @IsInt()
  @IsPositive()
  discountValue: number;

  @IsOptional()
  @IsString()
  discountReason?: string;

  @IsOptional()
  @IsISO8601()
  discountExpiresAt?: string;
}
