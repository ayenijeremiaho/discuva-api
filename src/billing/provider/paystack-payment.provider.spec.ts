import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { PaystackPaymentProvider } from './paystack-payment.provider';
import { Plan } from '../entity/plan.entity';

const SECRET = 'sk_test_secret';

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

describe('PaystackPaymentProvider', () => {
  let provider: PaystackPaymentProvider;

  beforeEach(async () => {
    jest.clearAllMocks();
    global.fetch = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaystackPaymentProvider,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'PAYSTACK_SECRET_KEY' ? SECRET : undefined,
            ),
          },
        },
        { provide: getRepositoryToken(Plan), useValue: mockPlanRepo },
      ],
    }).compile();
    provider = module.get(PaystackPaymentProvider);
  });

  it('createCustomer posts to /customer and returns the customer code', async () => {
    mockFetchOnce(200, { status: true, data: { customer_code: 'CUS_123' } });

    const result = await provider.createCustomer({
      id: 'tenant-1',
      name: 'Test Church',
      email: 'admin@example.com',
    });

    expect(result).toEqual({ providerCustomerId: 'CUS_123' });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.paystack.co/customer',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  describe('createSubscriptionCheckout', () => {
    it('lazily creates a Paystack plan when the local plan has no billingProviderPriceId yet', async () => {
      mockPlanRepo.findOneBy.mockResolvedValue({
        id: 'pro',
        name: 'Pro',
        priceCents: 500000,
        currency: 'NGN',
        billingProviderPriceId: null,
      });
      mockPlanRepo.save.mockResolvedValue({});
      mockFetchOnce(200, { status: true, data: { plan_code: 'PLN_new' } }); // create plan
      mockFetchOnce(200, {
        status: true,
        data: {
          authorization_url: 'https://paystack.com/pay/abc',
          reference: 'ref',
        },
      }); // initialize transaction

      const result = await provider.createSubscriptionCheckout({
        tenantId: 'tenant-1',
        planId: 'pro',
        providerCustomerId: 'CUS_123',
        email: 'admin@example.com',
        successUrl: 'https://app.example.com/success',
        cancelUrl: 'https://app.example.com/cancel',
      });

      expect(mockPlanRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ billingProviderPriceId: 'PLN_new' }),
      );
      expect(result.checkoutUrl).toBe('https://paystack.com/pay/abc');
      expect(result.providerSessionId).toMatch(/^sub_/);
    });

    it('reuses an existing billingProviderPriceId without creating a new plan', async () => {
      mockPlanRepo.findOneBy.mockResolvedValue({
        id: 'pro',
        name: 'Pro',
        priceCents: 500000,
        currency: 'NGN',
        billingProviderPriceId: 'PLN_existing',
      });
      mockFetchOnce(200, {
        status: true,
        data: {
          authorization_url: 'https://paystack.com/pay/xyz',
          reference: 'ref2',
        },
      });

      await provider.createSubscriptionCheckout({
        tenantId: 'tenant-1',
        planId: 'pro',
        providerCustomerId: 'CUS_123',
        email: 'admin@example.com',
        successUrl: 'https://a',
        cancelUrl: 'https://b',
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(mockPlanRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('verifyAndParseWebhook', () => {
    function sign(body: string): string {
      return createHmac('sha512', SECRET).update(body).digest('hex');
    }

    it('parses a charge.success event with a valid signature', () => {
      const body = JSON.stringify({
        event: 'charge.success',
        data: { reference: 'topup_abc' },
      });
      const event = provider.verifyAndParseWebhook(
        Buffer.from(body),
        sign(body),
      );
      expect(event).toEqual(
        expect.objectContaining({
          type: 'charge.succeeded',
          providerReference: 'topup_abc',
        }),
      );
    });

    it('throws on an invalid signature', () => {
      const body = JSON.stringify({ event: 'charge.success', data: {} });
      expect(() =>
        provider.verifyAndParseWebhook(Buffer.from(body), 'forged'),
      ).toThrow();
    });

    it('maps subscription.disable to subscription.canceled', () => {
      const body = JSON.stringify({
        event: 'subscription.disable',
        data: { subscription_code: 'SUB_123' },
      });
      const event = provider.verifyAndParseWebhook(
        Buffer.from(body),
        sign(body),
      );
      expect(event).toEqual(
        expect.objectContaining({
          type: 'subscription.canceled',
          providerSubscriptionId: 'SUB_123',
        }),
      );
    });
  });

  describe('refund', () => {
    it('posts to /refund with the transaction reference and amount', async () => {
      mockFetchOnce(200, { status: true, data: {} });

      await provider.refund('topup_abc', 50000);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.paystack.co/refund',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ transaction: 'topup_abc', amount: 50000 }),
        }),
      );
    });

    it('omits amount for a full refund', async () => {
      mockFetchOnce(200, { status: true, data: {} });

      await provider.refund('topup_abc');

      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.amount).toBeUndefined();
    });
  });
});
