import { IsInt, IsOptional, Min } from 'class-validator';

export class RefundCheckoutSessionDto {
  // Omitted means a full refund — see IPaymentProvider.refund().
  @IsOptional()
  @IsInt()
  @Min(1)
  amountCents?: number;
}
