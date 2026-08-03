import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { FlutterwavePaymentProvider } from './flutterwave-payment.provider';
import { Plan } from '../entity/plan.entity';

const SECRET_HASH = 'my-dashboard-secret-hash';

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

describe('FlutterwavePaymentProvider', () => {
  let provider: FlutterwavePaymentProvider;

  beforeEach(async () => {
    jest.clearAllMocks();
    global.fetch = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlutterwavePaymentProvider,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'FLUTTERWAVE_SECRET_KEY') return 'sk_test';
              if (key === 'FLUTTERWAVE_SECRET_HASH') return SECRET_HASH;
              return undefined;
            }),
          },
        },
        { provide: getRepositoryToken(Plan), useValue: mockPlanRepo },
      ],
    }).compile();
    provider = module.get(FlutterwavePaymentProvider);
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

  it('converts amountCents to major currency units (divides by 100) for one-off checkout', async () => {
    mockFetchOnce(200, {
      status: 'success',
      data: { link: 'https://flutterwave.com/pay/abc' },
    });

    await provider.createOneOffCheckout({
      tenantId: 'tenant-1',
      providerCustomerId: 'admin@example.com',
      email: 'admin@example.com',
      amountCents: 500000,
      description: '5000 SMS credits',
      successUrl: 'https://a',
      cancelUrl: 'https://b',
    });

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.amount).toBe(5000);
  });

  it('lazily creates a Flutterwave payment plan when missing, then reuses it', async () => {
    mockPlanRepo.findOneBy.mockResolvedValue({
      id: 'pro',
      name: 'Pro',
      priceCents: 500000,
      currency: 'NGN',
      billingProviderPriceId: null,
    });
    mockPlanRepo.save.mockResolvedValue({});
    mockFetchOnce(200, { status: 'success', data: { id: 999 } }); // create plan
    mockFetchOnce(200, {
      status: 'success',
      data: { link: 'https://flutterwave.com/pay/sub' },
    }); // initiate payment

    const result = await provider.createSubscriptionCheckout({
      tenantId: 'tenant-1',
      planId: 'pro',
      providerCustomerId: 'admin@example.com',
      email: 'admin@example.com',
      successUrl: 'https://a',
      cancelUrl: 'https://b',
    });

    expect(mockPlanRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ billingProviderPriceId: '999' }),
    );
    expect(result.checkoutUrl).toBe('https://flutterwave.com/pay/sub');
  });

  describe('verifyAndParseWebhook', () => {
    it('parses a successful charge.completed event with a valid hash', () => {
      const body = JSON.stringify({
        event: 'charge.completed',
        data: { tx_ref: 'topup_abc', status: 'successful' },
      });
      const event = provider.verifyAndParseWebhook(
        Buffer.from(body),
        SECRET_HASH,
      );
      expect(event).toEqual(
        expect.objectContaining({
          type: 'charge.succeeded',
          providerReference: 'topup_abc',
        }),
      );
    });

    it('maps a non-successful charge.completed status to charge.failed', () => {
      const body = JSON.stringify({
        event: 'charge.completed',
        data: { tx_ref: 'topup_abc', status: 'failed' },
      });
      const event = provider.verifyAndParseWebhook(
        Buffer.from(body),
        SECRET_HASH,
      );
      expect(event.type).toBe('charge.failed');
    });

    it('throws when the verif-hash header does not match', () => {
      const body = JSON.stringify({ event: 'charge.completed', data: {} });
      expect(() =>
        provider.verifyAndParseWebhook(Buffer.from(body), 'wrong-hash'),
      ).toThrow();
    });
  });

  describe('refund', () => {
    it('looks up the transaction id by tx_ref, then refunds by that id, converting cents to major units', async () => {
      mockFetchOnce(200, { status: 'success', data: [{ id: 998877 }] });
      mockFetchOnce(200, { status: 'success', data: {} });

      await provider.refund('topup_abc', 50000);

      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('/transactions?tx_ref=topup_abc'),
        expect.any(Object),
      );
      const [, options] = (global.fetch as jest.Mock).mock.calls[1];
      expect((global.fetch as jest.Mock).mock.calls[1][0]).toContain(
        '/transactions/998877/refund',
      );
      expect(JSON.parse(options.body)).toEqual({ amount: 500 });
    });

    it('throws when no matching transaction is found for the reference', async () => {
      mockFetchOnce(200, { status: 'success', data: [] });

      await expect(provider.refund('unknown-ref')).rejects.toThrow(
        'No Flutterwave transaction found',
      );
    });
  });
});
