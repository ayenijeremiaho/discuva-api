import { InternalServerErrorException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { KoraPaymentProvider } from './kora-payment.provider';
import { Plan } from '../entity/plan.entity';

const SECRET_KEY = 'sk_test_kora_platform';

const mockPlanRepo = {
  findOneBy: jest.fn(),
  save: jest.fn(),
};

function mockFetchOnce(status: number, body: any) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    json: async () => body,
  });
}

describe('KoraPaymentProvider', () => {
  let provider: KoraPaymentProvider;

  beforeEach(async () => {
    jest.clearAllMocks();
    global.fetch = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KoraPaymentProvider,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'KORA_SECRET_KEY' ? SECRET_KEY : undefined,
            ),
          },
        },
        { provide: getRepositoryToken(Plan), useValue: mockPlanRepo },
      ],
    }).compile();
    provider = module.get(KoraPaymentProvider);
  });

  it('createCustomer synthesizes providerCustomerId from email with no API call', async () => {
    const result = await provider.createCustomer({
      id: 'tenant-1',
      name: 'Test Church',
      email: 'admin@example.com',
    });
    expect(result).toEqual({ providerCustomerId: 'admin@example.com' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  describe('createSubscriptionCheckout', () => {
    it('charges the plan price once (no lazy plan-object creation, unlike Paystack/Flutterwave)', async () => {
      mockPlanRepo.findOneBy.mockResolvedValue({
        id: 'pro',
        name: 'Pro',
        priceCents: 500000,
        currency: 'NGN',
      });
      mockFetchOnce(200, {
        status: true,
        data: { checkout_url: 'https://checkout.korapay.com/sub' },
      });

      const result = await provider.createSubscriptionCheckout({
        tenantId: 'tenant-1',
        planId: 'pro',
        providerCustomerId: 'admin@example.com',
        email: 'admin@example.com',
        successUrl: 'https://a',
        cancelUrl: 'https://b',
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe(
        'https://api.korapay.com/merchant/api/v1/charges/initialize',
      );
      const body = JSON.parse(options.body);
      expect(body.amount).toBe(5000); // major unit, divided by 100
      expect(body.currency).toBe('NGN');
      expect(body.reference).toMatch(/^sub_/);
      expect(result.checkoutUrl).toBe('https://checkout.korapay.com/sub');
    });

    it('throws for an unknown planId', async () => {
      mockPlanRepo.findOneBy.mockResolvedValue(null);
      await expect(
        provider.createSubscriptionCheckout({
          tenantId: 'tenant-1',
          planId: 'nope',
          providerCustomerId: 'admin@example.com',
          email: 'admin@example.com',
          successUrl: 'https://a',
          cancelUrl: 'https://b',
        }),
      ).rejects.toThrow('Unknown plan "nope"');
    });
  });

  it('createOneOffCheckout divides amountCents by 100 before sending', async () => {
    mockFetchOnce(200, {
      status: true,
      data: { checkout_url: 'https://checkout.korapay.com/topup' },
    });

    await provider.createOneOffCheckout({
      tenantId: 'tenant-1',
      providerCustomerId: 'admin@example.com',
      email: 'admin@example.com',
      amountCents: 500000,
      description: 'top up',
      successUrl: 'https://a',
      cancelUrl: 'https://b',
    });

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.amount).toBe(5000);
    expect(body.reference).toMatch(/^topup_/);
  });

  it('cancelSubscription resolves as a no-op — Korapay has no server-side subscription object', async () => {
    await expect(
      provider.cancelSubscription('anything'),
    ).resolves.toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refund throws — not implemented against a verified Korapay endpoint', async () => {
    await expect(provider.refund('ref-1', 1000)).rejects.toThrow(
      InternalServerErrorException,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  describe('verifyAndParseWebhook', () => {
    it('accepts a signature computed over the data object only, keyed by the platform secret', () => {
      const data = { reference: 'sub_abc123', status: 'success' };
      const payload = JSON.stringify({ event: 'charge.success', data });
      const signature = createHmac('sha256', SECRET_KEY)
        .update(JSON.stringify(data))
        .digest('hex');

      const event = provider.verifyAndParseWebhook(
        Buffer.from(payload),
        signature,
      );

      expect(event).toEqual({
        type: 'charge.succeeded',
        providerReference: 'sub_abc123',
        raw: expect.any(Object),
      });
    });

    it('maps any non-charge.success event to charge.failed', () => {
      const data = { reference: 'sub_abc123' };
      const payload = JSON.stringify({ event: 'charge.failed', data });
      const signature = createHmac('sha256', SECRET_KEY)
        .update(JSON.stringify(data))
        .digest('hex');

      const event = provider.verifyAndParseWebhook(
        Buffer.from(payload),
        signature,
      );

      expect(event.type).toBe('charge.failed');
    });

    it('throws when the signature does not match', () => {
      const payload = JSON.stringify({
        event: 'charge.success',
        data: { reference: 'x' },
      });
      expect(() =>
        provider.verifyAndParseWebhook(Buffer.from(payload), 'bogus'),
      ).toThrow(InternalServerErrorException);
    });
  });
});
