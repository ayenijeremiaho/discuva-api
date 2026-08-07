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
        metadata: { cancel_url: params.cancelUrl, payerName: params.payerName },
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
