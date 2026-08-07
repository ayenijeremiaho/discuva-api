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
  KORA_GIVING_PROVIDER_NAME,
} from '../interface/giving-provider.interface';

// Korapay's Initialize Charge endpoint takes `amount` in the currency's
// major unit (naira, not kobo) — same "not the smallest unit" situation as
// Flutterwave, amountCents divided by 100 before being sent.
@Injectable()
export class KoraGivingProvider implements IGivingProvider {
  readonly providerName = KORA_GIVING_PROVIDER_NAME;
  private readonly logger = new Logger(KoraGivingProvider.name);
  private readonly baseUrl = 'https://api.korapay.com/merchant/api/v1';

  async createCheckoutSession(
    params: GivingCheckoutParams,
  ): Promise<GivingCheckoutResult> {
    const { secretKey } = params.credentials;
    const response = await fetch(`${this.baseUrl}/charges/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: params.amountCents / 100,
        currency: params.currency,
        reference: params.reference,
        redirect_url: params.successUrl,
        customer: { email: params.payerEmail, name: params.payerName },
      }),
    });
    const json: any = await response.json().catch(() => ({}));

    if (!response.ok || json.status !== true) {
      this.logger.error(
        `Korapay charges/initialize failed: ${JSON.stringify(json)}`,
      );
      throw new InternalServerErrorException(
        json.message || 'Failed to initialize Korapay checkout.',
      );
    }

    return { checkoutUrl: json.data.checkout_url };
  }

  // Korapay signs the `data` object (not the full envelope) with
  // HMAC-SHA256 keyed by the secret key — the x-korapay-signature header is
  // that digest, hex-encoded. timingSafeEqual for the same constant-time
  // reasoning as Paystack/Flutterwave above.
  verifyAndParseWebhook(
    rawBody: Buffer,
    signatureHeader: string,
    credentials: GivingProviderCredentials,
  ): NormalizedGivingEvent {
    const payload = JSON.parse(rawBody.toString('utf-8'));
    const data = payload.data ?? {};

    const expected = createHmac('sha256', credentials.secretKey)
      .update(JSON.stringify(data))
      .digest('hex');
    const expectedBuf = Buffer.from(expected, 'utf-8');
    const actualBuf = Buffer.from(signatureHeader || '', 'utf-8');
    const valid =
      expectedBuf.length === actualBuf.length &&
      timingSafeEqual(expectedBuf, actualBuf);

    if (!valid) {
      throw new InternalServerErrorException('Invalid Korapay signature.');
    }

    const event = payload.event as string;
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
