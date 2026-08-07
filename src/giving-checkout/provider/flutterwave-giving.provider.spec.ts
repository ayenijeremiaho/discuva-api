import { InternalServerErrorException } from '@nestjs/common';
import { FlutterwaveGivingProvider } from './flutterwave-giving.provider';

describe('FlutterwaveGivingProvider', () => {
  let provider: FlutterwaveGivingProvider;
  const credentials = {
    secretKey: 'FLWSECK_TEST-abc',
    secretHash: 'my-verif-hash',
  };
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
    provider = new FlutterwaveGivingProvider();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createCheckoutSession', () => {
    it('divides amountCents by 100 before sending (major unit, not kobo)', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'success',
            data: { link: 'https://flutterwave.com/pay/abc' },
          }),
      } as any);

      const result = await provider.createCheckoutSession(baseParams);

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.flutterwave.com/v3/payments');
      expect((options as any).headers.Authorization).toBe(
        'Bearer FLWSECK_TEST-abc',
      );
      const body = JSON.parse((options as any).body);
      expect(body.amount).toBe(5000);
      expect(body.tx_ref).toBe('giving_abc123');
      expect(result.checkoutUrl).toBe('https://flutterwave.com/pay/abc');
    });

    it('throws when Flutterwave responds with status: error', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ status: 'error', message: 'Invalid key' }),
      } as any);

      await expect(provider.createCheckoutSession(baseParams)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('verifyAndParseWebhook', () => {
    it('accepts a matching verif-hash and maps a successful charge', () => {
      const payload = JSON.stringify({
        event: 'charge.completed',
        data: { status: 'successful', tx_ref: 'giving_abc123' },
      });

      const result = provider.verifyAndParseWebhook(
        Buffer.from(payload),
        'my-verif-hash',
        credentials,
      );

      expect(result).toEqual({
        type: 'charge.succeeded',
        providerReference: 'giving_abc123',
        raw: expect.any(Object),
      });
    });

    it('rejects a mismatched verif-hash', () => {
      const payload = JSON.stringify({ event: 'charge.completed', data: {} });
      expect(() =>
        provider.verifyAndParseWebhook(
          Buffer.from(payload),
          'wrong-hash',
          credentials,
        ),
      ).toThrow(InternalServerErrorException);
    });

    it('maps a non-successful charge to charge.failed', () => {
      const payload = JSON.stringify({
        event: 'charge.completed',
        data: { status: 'failed', tx_ref: 'giving_abc123' },
      });

      const result = provider.verifyAndParseWebhook(
        Buffer.from(payload),
        'my-verif-hash',
        credentials,
      );

      expect(result.type).toBe('charge.failed');
    });
  });
});
