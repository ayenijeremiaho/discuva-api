import { InternalServerErrorException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { MonnifyPaymentProvider } from './monnify-payment.provider';

describe('MonnifyPaymentProvider', () => {
  const env: Record<string, string> = {
    MONNIFY_API_KEY: 'MK_TEST_PLATFORM',
    MONNIFY_SECRET_KEY: 'platform-secret',
    MONNIFY_CONTRACT_CODE: '999',
  };
  const planRepo = { findOneBy: jest.fn() };
  const build = (vars = env) =>
    new MonnifyPaymentProvider(
      { get: (key: string) => vars[key] } as any,
      planRepo as any,
    );
  const ok = (body: unknown) =>
    ({ ok: true, json: () => Promise.resolve(body) }) as any;
  const sign = (body: string) =>
    createHmac('sha512', env.MONNIFY_SECRET_KEY).update(body).digest('hex');

  afterEach(() => jest.restoreAllMocks());

  it("charges the plan's price once, through the sandbox for test keys", async () => {
    planRepo.findOneBy.mockResolvedValue({
      id: 'pro',
      name: 'Pro',
      priceCents: 1500000,
      currency: 'NGN',
    });
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        ok({
          requestSuccessful: true,
          responseBody: { accessToken: 't', expiresIn: 3600 },
        }),
      )
      .mockResolvedValueOnce(
        ok({
          requestSuccessful: true,
          responseBody: { checkoutUrl: 'https://pay/x' },
        }),
      );

    const session = await build().createSubscriptionCheckout({
      tenantId: 't1',
      planId: 'pro',
      providerCustomerId: 'admin@church.org',
      email: 'admin@church.org',
      successUrl: 'https://admin/billing?ok',
      cancelUrl: 'https://admin/billing',
    });

    expect(fetchSpy.mock.calls[1][0]).toBe(
      'https://sandbox.monnify.com/api/v1/merchant/transactions/init-transaction',
    );
    const body = JSON.parse((fetchSpy.mock.calls[1][1] as any).body);
    expect(body).toMatchObject({
      amount: 15000,
      contractCode: '999',
      currencyCode: 'NGN',
    });
    expect(session.providerSessionId).toMatch(/^sub_/);
    expect(body.paymentReference).toBe(session.providerSessionId);
    expect(session.checkoutUrl).toBe('https://pay/x');
  });

  it('refuses to start a checkout when the platform has no Monnify keys', async () => {
    await expect(
      build({}).createOneOffCheckout({
        tenantId: 't1',
        providerCustomerId: 'a',
        email: 'a@b.c',
        amountCents: 100,
        description: 'x',
        successUrl: 'u',
        cancelUrl: 'u',
      }),
    ).rejects.toThrow('Monnify is not configured');
  });

  it('refunds fail loudly and cancelling is a no-op', async () => {
    await expect(build().refund('sub_1')).rejects.toThrow(
      InternalServerErrorException,
    );
    await expect(build().cancelSubscription('x')).resolves.toBeUndefined();
  });

  describe('webhooks', () => {
    const parse = (eventData: Record<string, unknown>) => {
      const raw = JSON.stringify({
        eventType: 'SUCCESSFUL_TRANSACTION',
        eventData,
      });
      return build().verifyAndParseWebhook(Buffer.from(raw), sign(raw));
    };

    it('rejects a bad signature', () => {
      expect(() =>
        build().verifyAndParseWebhook(Buffer.from('{}'), 'bad'),
      ).toThrow(InternalServerErrorException);
    });

    it('activates only on a full payment', () => {
      expect(
        parse({ paymentReference: 'sub_1', paymentStatus: 'PAID' }),
      ).toMatchObject({
        type: 'charge.succeeded',
        providerReference: 'sub_1',
      });
    });

    it('leaves part/over-payments pending instead of activating or failing them', () => {
      const event = parse({
        paymentReference: 'sub_1',
        paymentStatus: 'PARTIALLY_PAID',
      });
      expect(event.type).toBe('charge.failed');
      expect(event.providerReference).toBeUndefined();
    });
  });
});
