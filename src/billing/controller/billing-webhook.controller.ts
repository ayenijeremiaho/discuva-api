import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../../auth/decorator/public.decorator';
import { CheckoutService } from '../service/checkout.service';
import {
  FLUTTERWAVE_PROVIDER_NAME,
  PAYSTACK_PROVIDER_NAME,
} from '../interface/payment-provider.interface';

// Paystack/Flutterwave never send a bearer token — the global JwtAuthGuard
// would 401 them before this handler's own signature check ever runs (same
// @Public() + own-signature-verification shape as YoutubeWebhookController).
// A single route handles both providers, distinguished by which of their two
// very different signature headers is present — Paystack signs with
// x-paystack-signature (HMAC), Flutterwave with verif-hash (shared secret).
@Controller('webhooks/billing')
export class BillingWebhookController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') paystackSignature?: string,
    @Headers('verif-hash') flutterwaveSignature?: string,
  ): Promise<void> {
    if (paystackSignature) {
      await this.checkoutService.handleWebhookEvent(
        PAYSTACK_PROVIDER_NAME,
        req.rawBody!,
        paystackSignature,
      );
      return;
    }
    if (flutterwaveSignature) {
      await this.checkoutService.handleWebhookEvent(
        FLUTTERWAVE_PROVIDER_NAME,
        req.rawBody!,
        flutterwaveSignature,
      );
      return;
    }
    // Neither header present — not a legitimate provider call. Still 200s
    // (HttpCode above) rather than 4xx, the same "ack fast, never leak
    // verification outcome" posture as the YouTube webhook controller.
  }
}
