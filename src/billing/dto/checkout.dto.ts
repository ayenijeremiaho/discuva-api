import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import {
  FLUTTERWAVE_PROVIDER_NAME,
  PAYSTACK_PROVIDER_NAME,
} from '../interface/payment-provider.interface';

export class InitiateSubscriptionCheckoutDto {
  @IsString()
  @IsNotEmpty()
  planId: string;

  @IsOptional()
  @IsIn([PAYSTACK_PROVIDER_NAME, FLUTTERWAVE_PROVIDER_NAME])
  provider?: string;

  @IsString()
  @IsNotEmpty()
  successUrl: string;

  @IsString()
  @IsNotEmpty()
  cancelUrl: string;
}
