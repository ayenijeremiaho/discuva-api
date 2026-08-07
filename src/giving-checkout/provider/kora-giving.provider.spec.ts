import { InternalServerErrorException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { KoraGivingProvider } from './kora-giving.provider';

describe('KoraGivingProvider', () => {
  let provider: KoraGivingProvider;
  const credentials = { secretKey: 'sk_test_kora' };
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
    provider = new KoraGivingProvider();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createCheckoutSession', () => {
    it('divides amountCents by 100 before sending (major unit) and returns the checkout URL', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: true,
            data: {
              checkout_url: 'https://checkout.korapay.com/abc',
              reference: 'giving_abc123',
            },
          }),
      } as any);

      const result = await provider.createCheckoutSession(baseParams);

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe(
        'https://api.korapay.com/merchant/api/v1/charges/initialize',
      );
      expect((options as any).headers.Authorization).toBe(
        'Bearer sk_test_kora',
      );
      const body = JSON.parse((options as any).body);
      expect(body.amount).toBe(5000);
      expect(body.reference).toBe('giving_abc123');
      expect(result.checkoutUrl).toBe('https://checkout.korapay.com/abc');
    });

    it('throws when Korapay responds with status: false', async () => {
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
    it('accepts a signature computed over the data object only', () => {
      const data = { reference: 'giving_abc123', status: 'success' };
      const payload = JSON.stringify({ event: 'charge.success', data });
      const signature = createHmac('sha256', credentials.secretKey)
        .update(JSON.stringify(data))
        .digest('hex');

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
      const payload = JSON.stringify({
        event: 'charge.success',
        data: { reference: 'x' },
      });
      expect(() =>
        provider.verifyAndParseWebhook(
          Buffer.from(payload),
          'bogus',
          credentials,
        ),
      ).toThrow(InternalServerErrorException);
    });
  });
});
