import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  GivingCheckoutParams,
  GivingCheckoutResult,
  GivingProviderCredentials,
  IGivingProvider,
  NormalizedGivingEvent,
  STRIPE_GIVING_PROVIDER_NAME,
} from '../interface/giving-provider.interface';

// Stripe's API is form-urlencoded, not JSON, unlike every other provider in
// this codebase — bracket notation (`line_items[0][price_data]...`) is how
// its API represents nested/array params over a flat form body. `unit_amount`
// is the smallest currency unit (cents), same convention as amountCents
// here — no conversion needed, same as Paystack. `client_reference_id` is
// Checkout Session's own purpose-built field for "the caller's own
// reference," used instead of stuffing it into metadata.
@Injectable()
export class StripeGivingProvider implements IGivingProvider {
  readonly providerName = STRIPE_GIVING_PROVIDER_NAME;
  private readonly logger = new Logger(StripeGivingProvider.name);
  private readonly baseUrl = 'https://api.stripe.com/v1';

  async createCheckoutSession(
    params: GivingCheckoutParams,
  ): Promise<GivingCheckoutResult> {
    const { secretKey } = params.credentials;
    const body = new URLSearchParams({
      mode: 'payment',
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      customer_email: params.payerEmail,
      client_reference_id: params.reference,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': params.currency,
      'line_items[0][price_data][unit_amount]': String(params.amountCents),
      'line_items[0][price_data][product_data][name]': `Giving — ${params.payerName}`,
    });

    const response = await fetch(`${this.baseUrl}/checkout/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    const json: any = await response.json().catch(() => ({}));

    if (!response.ok) {
      this.logger.error(
        `Stripe checkout/sessions failed: ${JSON.stringify(json)}`,
      );
      throw new InternalServerErrorException(
        json.error?.message || 'Failed to initialize Stripe checkout.',
      );
    }

    return { checkoutUrl: json.url };
  }

  // Stripe-Signature header is `t=<timestamp>,v1=<signature>[,v0=...]` —
  // the expected signature is HMAC-SHA256 of `${timestamp}.${rawBody}`
  // keyed by the tenant's webhook signing secret (credentials.webhookSecret,
  // a Stripe-issued value distinct from the API secret key).
  verifyAndParseWebhook(
    rawBody: Buffer,
    signatureHeader: string,
    credentials: GivingProviderCredentials,
  ): NormalizedGivingEvent {
    const parts = Object.fromEntries(
      (signatureHeader || '')
        .split(',')
        .map((p) => p.split('=') as [string, string]),
    );
    const timestamp = parts.t;
    const v1 = parts.v1;

    if (!timestamp || !v1) {
      throw new InternalServerErrorException(
        'Invalid Stripe signature header.',
      );
    }

    const expected = createHmac('sha256', credentials.webhookSecret)
      .update(`${timestamp}.${rawBody.toString('utf-8')}`)
      .digest('hex');
    const expectedBuf = Buffer.from(expected, 'utf-8');
    const actualBuf = Buffer.from(v1, 'utf-8');
    const valid =
      expectedBuf.length === actualBuf.length &&
      timingSafeEqual(expectedBuf, actualBuf);

    if (!valid) {
      throw new InternalServerErrorException('Invalid Stripe signature.');
    }

    const payload = JSON.parse(rawBody.toString('utf-8'));
    const object = payload.data?.object ?? {};

    if (payload.type === 'checkout.session.completed') {
      return {
        type:
          object.payment_status === 'paid'
            ? 'charge.succeeded'
            : 'charge.failed',
        providerReference: object.client_reference_id,
        raw: payload,
      };
    }
    return { type: 'charge.failed', raw: payload };
  }
}
