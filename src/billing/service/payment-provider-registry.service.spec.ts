import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { PaymentProviderRegistryService } from './payment-provider-registry.service';
import { PaystackPaymentProvider } from '../provider/paystack-payment.provider';
import { FlutterwavePaymentProvider } from '../provider/flutterwave-payment.provider';
import { KoraPaymentProvider } from '../provider/kora-payment.provider';
import { MonnifyPaymentProvider } from '../provider/monnify-payment.provider';
import { PlatformPaymentProvider } from '../entity/payment-provider.entity';

const mockPaystack = { providerName: 'paystack' };
const mockFlutterwave = { providerName: 'flutterwave' };
const mockKora = { providerName: 'kora' };
const mockMonnify = { providerName: 'monnify' };

describe('PaymentProviderRegistryService', () => {
  let mockProviderRepo: { findOneBy: jest.Mock; find: jest.Mock };

  async function build(
    defaultProvider?: string,
    env: Record<string, string> = {},
  ) {
    mockProviderRepo = {
      findOneBy: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentProviderRegistryService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'DEFAULT_PAYMENT_PROVIDER' ? defaultProvider : env[key],
            ),
          },
        },
        {
          provide: getRepositoryToken(PlatformPaymentProvider),
          useValue: mockProviderRepo,
        },
        { provide: PaystackPaymentProvider, useValue: mockPaystack },
        { provide: FlutterwavePaymentProvider, useValue: mockFlutterwave },
        { provide: KoraPaymentProvider, useValue: mockKora },
        { provide: MonnifyPaymentProvider, useValue: mockMonnify },
      ],
    }).compile();
    return module.get(PaymentProviderRegistryService);
  }

  it('returns the named provider', async () => {
    const registry = await build();
    expect(registry.get('flutterwave')).toBe(mockFlutterwave);
  });

  it('returns monnify when named', async () => {
    const registry = await build();
    expect(registry.get('monnify')).toBe(mockMonnify);
  });

  it('offers only providers that are switched on and configured', async () => {
    const registry = await build(undefined, {
      PAYSTACK_SECRET_KEY: 'sk',
      MONNIFY_API_KEY: 'MK_PROD_X',
    });
    mockProviderRepo.find.mockResolvedValue([
      { id: 'flutterwave', name: 'Flutterwave', isActive: true },
      { id: 'monnify', name: 'Monnify (Moniepoint)', isActive: true },
      { id: 'paystack', name: 'Paystack', isActive: true },
      { id: 'kora', name: 'Korapay', isActive: false },
      { id: 'legacy', name: 'Legacy', isActive: true },
    ]);

    await expect(registry.listAvailable()).resolves.toEqual([
      { id: 'monnify', name: 'Monnify (Moniepoint)' },
      { id: 'paystack', name: 'Paystack' },
    ]);
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

  describe('assertActive', () => {
    it('returns the provider when no DB row exists yet (treated as active)', async () => {
      const registry = await build();
      mockProviderRepo.findOneBy.mockResolvedValue(null);
      await expect(registry.assertActive('paystack')).resolves.toBe(
        mockPaystack,
      );
    });

    it('returns the provider when the DB row is active', async () => {
      const registry = await build();
      mockProviderRepo.findOneBy.mockResolvedValue({
        id: 'paystack',
        isActive: true,
      });
      await expect(registry.assertActive('paystack')).resolves.toBe(
        mockPaystack,
      );
    });

    it('throws when the DB row is deactivated', async () => {
      const registry = await build();
      mockProviderRepo.findOneBy.mockResolvedValue({
        id: 'paystack',
        isActive: false,
      });
      await expect(registry.assertActive('paystack')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('still throws on an unknown provider name before ever checking the DB', async () => {
      const registry = await build();
      await expect(registry.assertActive('stripe')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
