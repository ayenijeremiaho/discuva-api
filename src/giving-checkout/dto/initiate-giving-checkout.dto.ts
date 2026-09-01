import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class InitiateGivingCheckoutDto {
  @IsInt()
  @Min(1)
  amountCents: number;

  // What this gift is for (Tithe/Offering/General Giving/etc.) — mutually
  // exclusive with pledgeId, enforced in GivingCheckoutService.
  @IsOptional()
  @IsUUID()
  givingOptionId?: string;

  // Designates this payment toward one of the member's own active pledges
  // instead — creates a PledgeContribution, not a TitheRecord. Mutually
  // exclusive with givingOptionId.
  @IsOptional()
  @IsUUID()
  pledgeId?: string;

  @IsString()
  @IsNotEmpty()
  successUrl: string;

  @IsString()
  @IsNotEmpty()
  cancelUrl: string;
}
