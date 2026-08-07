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

  @IsString()
  @IsNotEmpty()
  successUrl: string;

  @IsString()
  @IsNotEmpty()
  cancelUrl: string;
}
