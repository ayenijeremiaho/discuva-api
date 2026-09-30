import { IsIn, IsNotEmpty, IsObject } from 'class-validator';

export class UpsertGivingProviderConfigDto {
  // Flat string map — provider-specific shape, deliberately not typed
  // further here (same convention as SmsProviderCredentials): Paystack/Kora
  // `{ secretKey }`, Flutterwave `{ secretKey, secretHash }`, Stripe
  // `{ secretKey, webhookSecret }`, Monnify `{ apiKey, secretKey, contractCode }`.
  @IsObject()
  @IsNotEmpty()
  credentials: Record<string, string>;
}

export class SetGivingProviderActiveDto {
  @IsIn([true, false])
  isActive: boolean;
}
