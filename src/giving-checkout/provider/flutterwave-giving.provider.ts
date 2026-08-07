import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import {
  GivingCheckoutParams,
  GivingCheckoutResult,
  GivingProviderCredentials,
  IGivingProvider,
  NormalizedGivingEvent,
  FLUTTERWAVE_GIVING_PROVIDER_NAME,
} from '../interface/giving-provider.interface';

// BYOK counterpart to billing's FlutterwavePaymentProvider. Flutterwave's
// Standard Payment endpoint takes `amount` in the currency's major unit
// (naira, not kobo) — amountCents here is always the smallest unit, same
// convention as everywhere else in this codebase, so it's divided by 100
// before being sent. `secretKey`/`secretHash` come from the tenant's own
// decrypted credentials, never ConfigService.
@Injectable()
export class FlutterwaveGivingProvider implements IGivingProvider {
  readonly providerName = FLUTTERWAVE_GIVING_PROVIDER_NAME;
  private readonly logger = new Logger(FlutterwaveGivingProvider.name);
  private readonly baseUrl = 'https://api.flutterwave.com/v3';

  async createCheckoutSession(
    params: GivingCheckoutParams,
  ): Promise<GivingCheckoutResult> {
    const { secretKey } = params.credentials;
    const response = await fetch(`${this.baseUrl}/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tx_ref: params.reference,
        amount: params.amountCents / 100,
        currency: params.currency,
        redirect_url: params.successUrl,
        customer: { email: params.payerEmail, name: params.payerName },
        meta: { cancel_url: params.cancelUrl },
      }),
    });
    const json: any = await response.json().catch(() => ({}));

    if (!response.ok || json.status === 'error') {
      this.logger.error(`Flutterwave payments failed: ${JSON.stringify(json)}`);
      throw new InternalServerErrorException(
        json.message || 'Failed to initialize Flutterwave checkout.',
      );
    }

    return { checkoutUrl: json.data.link };
  }

  // Direct shared-secret string comparison (verif-hash), not an HMAC — same
  // as billing's FlutterwavePaymentProvider.
  verifyAndParseWebhook(
    rawBody: Buffer,
    signatureHeader: string,
    credentials: GivingProviderCredentials,
  ): NormalizedGivingEvent {
    const expectedBuf = Buffer.from(credentials.secretHash || '', 'utf-8');
    const actualBuf = Buffer.from(signatureHeader || '', 'utf-8');
    const valid =
      expectedBuf.length > 0 &&
      expectedBuf.length === actualBuf.length &&
      timingSafeEqual(expectedBuf, actualBuf);

    if (!valid) {
      throw new InternalServerErrorException('Invalid Flutterwave signature.');
    }

    const payload = JSON.parse(rawBody.toString('utf-8'));
    const event = payload.event as string;
    const data = payload.data ?? {};

    if (event === 'charge.completed') {
      return {
        type:
          data.status === 'successful' ? 'charge.succeeded' : 'charge.failed',
        providerReference: data.tx_ref,
        raw: payload,
      };
    }
    return { type: 'charge.failed', raw: payload };
  }
}
