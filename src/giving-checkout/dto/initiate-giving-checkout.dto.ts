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

  // Which fund/account this is earmarked for — optional, purely
  // informational (mirrors ProofOfPaymentForm's titheAccountId), the
  // provider checkout itself has no concept of it.
  @IsOptional()
  @IsUUID()
  titheAccountId?: string;

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
