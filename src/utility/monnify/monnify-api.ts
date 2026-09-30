import { InternalServerErrorException, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Shared by church giving (each church's own keys) and platform billing (Discuva's keys).
export interface MonnifyCredentials {
  apiKey: string;
  secretKey: string;
  contractCode: string;
}

const LIVE_URL = 'https://api.monnify.com';
const SANDBOX_URL = 'https://sandbox.monnify.com';

// Sandbox keys start with MK_TEST_; there is no separate environment setting.
export function monnifyBaseUrl(apiKey?: string): string {
  return apiKey?.startsWith('MK_TEST_') ? SANDBOX_URL : LIVE_URL;
}

// monnify-signature is HMAC-SHA512 of the raw request body, keyed by the secret key.
export function isValidMonnifySignature(
  rawBody: Buffer,
  signature: string,
  secretKey: string,
): boolean {
  const expected = Buffer.from(
    createHmac('sha512', secretKey).update(rawBody).digest('hex'),
    'utf-8',
  );
  const actual = Buffer.from(signature || '', 'utf-8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export class MonnifyApi {
  private readonly tokens = new Map<
    string,
    { token: string; expiresAt: number }
  >();

  constructor(private readonly logger: Logger) {}

  // Bearer token from /auth/login, reused until a minute before it expires.
  private async accessToken(credentials: MonnifyCredentials): Promise<string> {
    const cacheKey = `${credentials.apiKey}:${credentials.secretKey}`;
    const cached = this.tokens.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const basic = Buffer.from(
      `${credentials.apiKey}:${credentials.secretKey}`,
    ).toString('base64');
    const body = await this.call(
      credentials,
      '/api/v1/auth/login',
      { Authorization: `Basic ${basic}` },
      undefined,
      'Failed to sign in to Monnify.',
    );
    const ttlSeconds = Number(body.expiresIn) || 300;
    this.tokens.set(cacheKey, {
      token: body.accessToken,
      expiresAt: Date.now() + Math.max(ttlSeconds - 60, 30) * 1000,
    });
    return body.accessToken;
  }

  // Amount in minor units; Monnify takes naira. Returns the hosted checkout URL.
  async initTransaction(
    credentials: MonnifyCredentials,
    params: {
      amountCents: number;
      currency: string;
      reference: string;
      customerName: string;
      customerEmail: string;
      description: string;
      redirectUrl: string;
    },
  ): Promise<string> {
    const token = await this.accessToken(credentials);
    const body = await this.call(
      credentials,
      '/api/v1/merchant/transactions/init-transaction',
      { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      {
        amount: params.amountCents / 100,
        customerName: params.customerName,
        customerEmail: params.customerEmail,
        paymentReference: params.reference,
        paymentDescription: params.description,
        currencyCode: params.currency,
        contractCode: credentials.contractCode,
        redirectUrl: params.redirectUrl,
        paymentMethods: ['CARD', 'ACCOUNT_TRANSFER', 'USSD'],
      },
      'Failed to initialize Monnify checkout.',
    );
    return body.checkoutUrl;
  }

  private async call(
    credentials: MonnifyCredentials,
    path: string,
    headers: Record<string, string>,
    payload: Record<string, unknown> | undefined,
    failure: string,
  ): Promise<any> {
    const response = await fetch(
      `${monnifyBaseUrl(credentials.apiKey)}${path}`,
      {
        method: 'POST',
        headers,
        body: payload ? JSON.stringify(payload) : undefined,
      },
    );
    const json: any = await response.json().catch(() => ({}));
    if (!response.ok || json.requestSuccessful !== true) {
      this.logger.error(`Monnify ${path} failed: ${JSON.stringify(json)}`);
      throw new InternalServerErrorException(json.responseMessage || failure);
    }
    return json.responseBody;
  }
}
