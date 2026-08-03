import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { PaymentProviderRegistryService } from './payment-provider-registry.service';
import { PaystackPaymentProvider } from '../provider/paystack-payment.provider';
import { FlutterwavePaymentProvider } from '../provider/flutterwave-payment.provider';

const mockPaystack = { providerName: 'paystack' };
const mockFlutterwave = { providerName: 'flutterwave' };

describe('PaymentProviderRegistryService', () => {
  async function build(defaultProvider?: string) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentProviderRegistryService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'DEFAULT_PAYMENT_PROVIDER' ? defaultProvider : undefined,
            ),
          },
        },
        { provide: PaystackPaymentProvider, useValue: mockPaystack },
        { provide: FlutterwavePaymentProvider, useValue: mockFlutterwave },
      ],
    }).compile();
    return module.get(PaymentProviderRegistryService);
  }

  it('returns the named provider', async () => {
    const registry = await build();
    expect(registry.get('flutterwave')).toBe(mockFlutterwave);
  });

  it('falls back to paystack by default when no provider name is given', async () => {
    const registry = await build();
    expect(registry.get()).toBe(mockPaystack);
  });

  it('honors DEFAULT_PAYMENT_PROVIDER when no provider name is given', async () => {
    const registry = await build('flutterwave');
    expect(registry.get()).toBe(mockFlutterwave);
  });

  it('throws a BadRequestException for an unknown provider name', async () => {
    const registry = await build();
    expect(() => registry.get('stripe')).toThrow(BadRequestException);
  });
});
