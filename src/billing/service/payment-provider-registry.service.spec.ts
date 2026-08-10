import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { PaymentProviderRegistryService } from './payment-provider-registry.service';
import { PaystackPaymentProvider } from '../provider/paystack-payment.provider';
import { FlutterwavePaymentProvider } from '../provider/flutterwave-payment.provider';
import { KoraPaymentProvider } from '../provider/kora-payment.provider';

const mockPaystack = { providerName: 'paystack' };
const mockFlutterwave = { providerName: 'flutterwave' };
const mockKora = { providerName: 'kora' };

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
        { provide: KoraPaymentProvider, useValue: mockKora },
      ],
    }).compile();
    return module.get(PaymentProviderRegistryService);
  }

  it('returns the named provider', async () => {
    const registry = await build();
    expect(registry.get('flutterwave')).toBe(mockFlutterwave);
  });

  it('returns kora when named', async () => {
    const registry = await build();
    expect(registry.get('kora')).toBe(mockKora);
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
