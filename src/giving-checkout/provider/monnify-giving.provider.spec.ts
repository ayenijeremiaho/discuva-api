import { InternalServerErrorException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { MonnifyGivingProvider } from './monnify-giving.provider';

describe('MonnifyGivingProvider', () => {
  let provider: MonnifyGivingProvider;
  const live = {
    apiKey: 'MK_PROD_ABC',
    secretKey: 'secret',
    contractCode: '123456',
  };
  const sandbox = { ...live, apiKey: 'MK_TEST_ABC' };
  const params = (credentials = live) => ({
    amountCents: 500000,
    currency: 'NGN',
    payerEmail: 'member@example.com',
    payerName: 'Jane Doe',
    reference: 'giving_abc123',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    credentials,
  });
  const ok = (body: unknown) =>
    ({ ok: true, json: () => Promise.resolve(body) }) as any;
  const login = ok({
    requestSuccessful: true,
    responseBody: { accessToken: 'tok', expiresIn: 3600 },
  });
  const init = ok({
    requestSuccessful: true,
    responseBody: { checkoutUrl: 'https://sandbox.sdk.monnify.com/checkout/x' },
  });
  const sign = (body: string) =>
    createHmac('sha512', live.secretKey).update(body).digest('hex');

  beforeEach(() => {
    provider = new MonnifyGivingProvider();
  });
  afterEach(() => jest.restoreAllMocks());

  describe('createCheckoutSession', () => {
    it('signs in, then initialises a transaction in naira with our reference', async () => {
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(login)
        .mockResolvedValueOnce(init);

      const result = await provider.createCheckoutSession(params());

      const [loginUrl, loginOpts] = fetchSpy.mock.calls[0];
      expect(loginUrl).toBe('https://api.monnify.com/api/v1/auth/login');
      expect((loginOpts as any).headers.Authorization).toBe(
        `Basic ${Buffer.from('MK_PROD_ABC:secret').toString('base64')}`,
      );
      const [initUrl, initOpts] = fetchSpy.mock.calls[1];
      expect(initUrl).toBe(
        'https://api.monnify.com/api/v1/merchant/transactions/init-transaction',
      );
      expect((initOpts as any).headers.Authorization).toBe('Bearer tok');
      expect(JSON.parse((initOpts as any).body)).toMatchObject({
        amount: 5000,
        paymentReference: 'giving_abc123',
        contractCode: '123456',
        currencyCode: 'NGN',
        redirectUrl: 'https://example.com/success',
      });
      expect(result.checkoutUrl).toBe(
        'https://sandbox.sdk.monnify.com/checkout/x',
      );
    });

    it('uses the sandbox for MK_TEST_ keys and reuses the sign-in token', async () => {
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(login)
        .mockResolvedValueOnce(init)
        .mockResolvedValueOnce(init);

      await provider.createCheckoutSession(params(sandbox));
      await provider.createCheckoutSession(params(sandbox));

      expect(fetchSpy.mock.calls[0][0]).toBe(
        'https://sandbox.monnify.com/api/v1/auth/login',
      );
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it('throws when Monnify rejects the request', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(login)
        .mockResolvedValueOnce(
          ok({
            requestSuccessful: false,
            responseMessage: 'Invalid contract code',
          }),
        );

      await expect(provider.createCheckoutSession(params())).rejects.toThrow(
        'Invalid contract code',
      );
    });
  });

  describe('verifyAndParseWebhook', () => {
    const event = (
      eventData: Record<string, unknown>,
      eventType = 'SUCCESSFUL_TRANSACTION',
    ) => JSON.stringify({ eventType, eventData });
    const parse = (body: string) =>
      provider.verifyAndParseWebhook(Buffer.from(body), sign(body), live);

    it('rejects an invalid signature', () => {
      const body = event({
        paymentReference: 'giving_abc123',
        paymentStatus: 'PAID',
      });
      expect(() =>
        provider.verifyAndParseWebhook(Buffer.from(body), 'bad', live),
      ).toThrow(InternalServerErrorException);
    });

    it('reads a paid transaction with channel, fees and card summary', () => {
      const result = parse(
        event({
          transactionReference: 'MNFY|20260930|000123',
          paymentReference: 'giving_abc123',
          amountPaid: 5000,
          totalPayable: 5000,
          settlementAmount: 4925,
          paidOn: '2026-09-30T08:15:00.000Z',
          paymentStatus: 'PAID',
          paymentMethod: 'CARD',
          currency: 'NGN',
          cardDetails: { cardType: 'Verve', last4: '1234' },
        }),
      );

      expect(result.type).toBe('charge.succeeded');
      expect(result.providerReference).toBe('giving_abc123');
      expect(result.payment).toEqual({
        transactionId: 'MNFY|20260930|000123',
        channel: 'card',
        paidAt: new Date('2026-09-30T08:15:00.000Z'),
        amountCents: null,
        currency: 'NGN',
        feesCents: 7500,
        details: {
          cardType: 'Verve',
          last4: '1234',
          bank: null,
          gatewayResponse: 'PAID',
        },
      });
    });

    it('passes the actual amount for part-payments so the charge is held for review', () => {
      const result = parse(
        event({
          paymentReference: 'giving_abc123',
          amountPaid: 3000,
          paymentStatus: 'PARTIALLY_PAID',
          paymentMethod: 'ACCOUNT_TRANSFER',
          currency: 'NGN',
        }),
      );

      expect(result.type).toBe('charge.succeeded');
      expect(result.payment?.amountCents).toBe(300000);
      expect(result.payment?.channel).toBe('bank_transfer');
    });

    it('fails a pending checkout only on an explicit failure, and ignores other events', () => {
      expect(
        parse(
          event({
            paymentReference: 'giving_abc123',
            paymentStatus: 'EXPIRED',
          }),
        ),
      ).toMatchObject({
        type: 'charge.failed',
        providerReference: 'giving_abc123',
      });
      expect(
        parse(
          event(
            { paymentReference: 'giving_abc123', paymentStatus: 'REFUNDED' },
            'SUCCESSFUL_REFUND',
          ),
        ),
      ).toMatchObject({ type: 'charge.failed', providerReference: undefined });
    });
  });
});
