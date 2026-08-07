import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../../auth/decorator/public.decorator';
import { GivingCheckoutService } from '../service/giving-checkout.service';

// Called directly by Paystack/Flutterwave/Kora/Stripe — no Host header
// carrying a tenant subdomain at all, so :tenantId is the only way to know
// which church this is for; excluded from TenantMiddleware entirely (same
// reasoning as v1/webhooks/billing and the YouTube WebSub callback —
// src/tenant/tenant.module.ts). :provider selects which signature header to
// read and which ISmsProvider-shaped class in GivingProviderRegistryService
// actually verifies it — each vendor signs differently (HMAC-SHA512 raw
// body, shared-secret string compare, HMAC-SHA256 over just the data
// object, or Stripe's t=/v1= timestamped scheme), so there is no single
// shared header to dispatch on the way billing's single route does.
@Controller('webhooks/giving')
export class GivingWebhookController {
  constructor(private readonly checkoutService: GivingCheckoutService) {}

  @Public()
  @Post(':tenantId/:provider')
  @HttpCode(HttpStatus.OK)
  async handle(
    @Param('tenantId') tenantId: string,
    @Param('provider') provider: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') paystackSig?: string,
    @Headers('verif-hash') flutterwaveSig?: string,
    @Headers('x-korapay-signature') koraSig?: string,
    @Headers('stripe-signature') stripeSig?: string,
  ): Promise<void> {
    const signature =
      paystackSig ?? flutterwaveSig ?? koraSig ?? stripeSig ?? '';
    await this.checkoutService.handleWebhook(
      tenantId,
      provider,
      req.rawBody!,
      signature,
    );
  }
}
