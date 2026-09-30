import { InternalServerErrorException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { StripeGivingProvider } from './stripe-giving.provider';

describe('StripeGivingProvider', () => {
  let provider: StripeGivingProvider;
  const credentials = {
    secretKey: 'sk_test_stripe',
    webhookSecret: 'whsec_test',
  };
  const baseParams = {
    amountCents: 500000,
    currency: 'usd',
    payerEmail: 'member@example.com',
    payerName: 'Jane Doe',
    reference: 'giving_abc123',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    credentials,
  };

  beforeEach(() => {
    provider = new StripeGivingProvider();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createCheckoutSession', () => {
    it('form-encodes the body and sets client_reference_id to the reference', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'cs_test_abc',
            url: 'https://checkout.stripe.com/abc',
          }),
      } as any);

      const result = await provider.createCheckoutSession(baseParams);

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
      expect((options as any).headers.Authorization).toBe(
        'Bearer sk_test_stripe',
      );
      expect((options as any).headers['Content-Type']).toBe(
        'application/x-www-form-urlencoded',
      );
      const body = (options as any).body as URLSearchParams;
      expect(body.get('client_reference_id')).toBe('giving_abc123');
      expect(body.get('line_items[0][price_data][unit_amount]')).toBe('500000');
      expect(result.checkoutUrl).toBe('https://checkout.stripe.com/abc');
    });

    it('throws when Stripe responds with a non-ok status', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: { message: 'Invalid API key' } }),
      } as any);

      await expect(provider.createCheckoutSession(baseParams)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('verifyAndParseWebhook', () => {
    function sign(timestamp: string, body: string): string {
      return createHmac('sha256', credentials.webhookSecret)
        .update(`${timestamp}.${body}`)
        .digest('hex');
    }

    it('accepts a validly signed checkout.session.completed event with payment_status: paid', () => {
      const payload = JSON.stringify({
        type: 'checkout.session.completed',
        data: {
          object: {
            payment_status: 'paid',
            client_reference_id: 'giving_abc123',
          },
        },
      });
      const timestamp = '1700000000';
      const signature = sign(timestamp, payload);

      const result = provider.verifyAndParseWebhook(
        Buffer.from(payload),
        `t=${timestamp},v1=${signature}`,
        credentials,
      );

      expect(result).toEqual({
        type: 'charge.succeeded',
        providerReference: 'giving_abc123',
        raw: expect.any(Object),
      });
    });

    it('rejects a malformed signature header', () => {
      const payload = JSON.stringify({
        type: 'checkout.session.completed',
        data: {},
      });
      expect(() =>
        provider.verifyAndParseWebhook(
          Buffer.from(payload),
          'not-the-right-shape',
          credentials,
        ),
      ).toThrow(InternalServerErrorException);
    });

    it('rejects a signature that does not match', () => {
      const payload = JSON.stringify({
        type: 'checkout.session.completed',
        data: {},
      });
      expect(() =>
        provider.verifyAndParseWebhook(
          Buffer.from(payload),
          't=123,v1=deadbeef',
          credentials,
        ),
      ).toThrow(InternalServerErrorException);
    });

    function parse(type: string, object: Record<string, unknown>) {
      const payload = JSON.stringify({ type, data: { object } });
      const timestamp = '1700000000';
      return provider.verifyAndParseWebhook(
        Buffer.from(payload),
        `t=${timestamp},v1=${sign(timestamp, payload)}`,
        credentials,
      );
    }

    it('leaves a delayed (unpaid) payment pending instead of failing it', () => {
      const result = parse('checkout.session.completed', {
        payment_status: 'unpaid',
        client_reference_id: 'giving_abc123',
      });
      expect(result.type).toBe('charge.failed');
      expect(result.providerReference).toBeUndefined();
    });

    it('completes a delayed payment once Stripe says it succeeded', () => {
      expect(
        parse('checkout.session.async_payment_succeeded', {
          payment_status: 'paid',
          client_reference_id: 'giving_abc123',
        }),
      ).toMatchObject({
        type: 'charge.succeeded',
        providerReference: 'giving_abc123',
      });
    });

    it.each([
      'checkout.session.async_payment_failed',
      'checkout.session.expired',
    ])('fails the checkout on %s', (type) => {
      expect(
        parse(type, { client_reference_id: 'giving_abc123' }),
      ).toMatchObject({
        type: 'charge.failed',
        providerReference: 'giving_abc123',
      });
    });

    it('ignores unrelated events', () => {
      const result = parse('payment_intent.created', {
        client_reference_id: 'giving_abc123',
      });
      expect(result.providerReference).toBeUndefined();
    });
  });
});
