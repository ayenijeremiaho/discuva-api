import { InternalServerErrorException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { PaystackGivingProvider } from './paystack-giving.provider';

describe('PaystackGivingProvider', () => {
  let provider: PaystackGivingProvider;
  const credentials = { secretKey: 'sk_test_123' };
  const baseParams = {
    amountCents: 500000,
    currency: 'NGN',
    payerEmail: 'member@example.com',
    payerName: 'Jane Doe',
    reference: 'giving_abc123',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    credentials,
  };

  beforeEach(() => {
    provider = new PaystackGivingProvider();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createCheckoutSession', () => {
    it('initializes a transaction with the tenant BYOK secret key and returns the authorization URL', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: true,
            data: {
              authorization_url: 'https://checkout.paystack.com/abc',
              reference: 'giving_abc123',
            },
          }),
      } as any);

      const result = await provider.createCheckoutSession(baseParams);

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.paystack.co/transaction/initialize');
      expect((options as any).headers.Authorization).toBe('Bearer sk_test_123');
      const body = JSON.parse((options as any).body);
      expect(body.amount).toBe(500000);
      expect(body.reference).toBe('giving_abc123');
      expect(result.checkoutUrl).toBe('https://checkout.paystack.com/abc');
    });

    it('throws when Paystack responds with status: false', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: false, message: 'Invalid key' }),
      } as any);

      await expect(provider.createCheckoutSession(baseParams)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('verifyAndParseWebhook', () => {
    function sign(body: string): string {
      return createHmac('sha512', credentials.secretKey)
        .update(body)
        .digest('hex');
    }

    it('accepts a validly signed charge.success event', () => {
      const payload = JSON.stringify({
        event: 'charge.success',
        data: { reference: 'giving_abc123' },
      });
      const signature = sign(payload);

      const result = provider.verifyAndParseWebhook(
        Buffer.from(payload),
        signature,
        credentials,
      );

      expect(result).toEqual({
        type: 'charge.succeeded',
        providerReference: 'giving_abc123',
        raw: expect.any(Object),
      });
    });

    it('rejects an invalid signature', () => {
      const payload = JSON.stringify({ event: 'charge.success', data: {} });
      expect(() =>
        provider.verifyAndParseWebhook(
          Buffer.from(payload),
          'not-a-real-signature',
          credentials,
        ),
      ).toThrow(InternalServerErrorException);
    });

    it('maps a non-success event to charge.failed', () => {
      const payload = JSON.stringify({
        event: 'charge.failed',
        data: { reference: 'giving_abc123' },
      });
      const signature = sign(payload);

      const result = provider.verifyAndParseWebhook(
        Buffer.from(payload),
        signature,
        credentials,
      );

      expect(result.type).toBe('charge.failed');
    });
  });
});
