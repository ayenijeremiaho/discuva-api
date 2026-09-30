import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  GivingCheckoutParams,
  GivingCheckoutResult,
  GivingPaymentDetails,
  GivingProviderCredentials,
  IGivingProvider,
  NormalizedGivingEvent,
  PAYSTACK_GIVING_PROVIDER_NAME,
} from '../interface/giving-provider.interface';

// BYOK counterpart to billing's PaystackPaymentProvider — same API shape
// (Initialize Transaction takes `amount` in the smallest currency unit,
// webhook signed HMAC-SHA512 over the raw body), but `secretKey` comes from
// the tenant's own decrypted credentials on every call, never from
// ConfigService — this is the church's own Paystack account, not the
// platform's merchant account.
@Injectable()
export class PaystackGivingProvider implements IGivingProvider {
  readonly providerName = PAYSTACK_GIVING_PROVIDER_NAME;
  private readonly logger = new Logger(PaystackGivingProvider.name);
  private readonly baseUrl = 'https://api.paystack.co';

  async createCheckoutSession(
    params: GivingCheckoutParams,
  ): Promise<GivingCheckoutResult> {
    const { secretKey } = params.credentials;
    const response = await fetch(`${this.baseUrl}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: params.payerEmail,
        amount: params.amountCents,
        currency: params.currency,
        reference: params.reference,
        callback_url: params.successUrl,
        // cancel_action is the metadata key Paystack uses to send a payer who cancels back to us.
        metadata: {
          cancel_action: params.cancelUrl,
          payerName: params.payerName,
        },
      }),
    });
    const json: any = await response.json().catch(() => ({}));

    if (!response.ok || json.status === false) {
      this.logger.error(`Paystack initialize failed: ${JSON.stringify(json)}`);
      throw new InternalServerErrorException(
        json.message || 'Failed to initialize Paystack checkout.',
      );
    }

    return { checkoutUrl: json.data.authorization_url };
  }

  // requested_amount excludes fees Paystack adds when the church passes charges to the payer.
  private static paymentDetails(
    data: Record<string, any>,
  ): GivingPaymentDetails {
    const num = (v: unknown) =>
      v === null || v === undefined || v === '' || Number.isNaN(Number(v))
        ? null
        : Number(v);
    const str = (v: unknown) =>
      v === null || v === undefined || v === '' ? null : String(v);
    const auth = data.authorization ?? {};
    return {
      transactionId: str(data.id),
      channel: str(data.channel),
      paidAt: data.paid_at ? new Date(data.paid_at) : null,
      amountCents: num(data.requested_amount) ?? num(data.amount),
      currency: str(data.currency),
      feesCents: num(data.fees),
      details: {
        cardType: str(auth.card_type),
        last4: str(auth.last4),
        bank: str(auth.bank),
        gatewayResponse: str(data.gateway_response),
      },
    };
  }

  verifyAndParseWebhook(
    rawBody: Buffer,
    signatureHeader: string,
    credentials: GivingProviderCredentials,
  ): NormalizedGivingEvent {
    const expected = createHmac('sha512', credentials.secretKey)
      .update(rawBody)
      .digest('hex');
    const expectedBuf = Buffer.from(expected, 'utf-8');
    const actualBuf = Buffer.from(signatureHeader || '', 'utf-8');
    const valid =
      expectedBuf.length === actualBuf.length &&
      timingSafeEqual(expectedBuf, actualBuf);

    if (!valid) {
      throw new InternalServerErrorException('Invalid Paystack signature.');
    }

    const payload = JSON.parse(rawBody.toString('utf-8'));
    const event = payload.event as string;
    const data = payload.data ?? {};

    if (event === 'charge.success') {
      return {
        type: 'charge.succeeded',
        providerReference: data.reference,
        payment: PaystackGivingProvider.paymentDetails(data),
        raw: payload,
      };
    }
    return {
      type: 'charge.failed',
      providerReference: data.reference,
      raw: payload,
    };
  }
}
