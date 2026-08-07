import { BadRequestException } from '@nestjs/common';
import { GivingProviderRegistryService } from './giving-provider-registry.service';
import { PaystackGivingProvider } from '../provider/paystack-giving.provider';
import { FlutterwaveGivingProvider } from '../provider/flutterwave-giving.provider';
import { KoraGivingProvider } from '../provider/kora-giving.provider';
import { StripeGivingProvider } from '../provider/stripe-giving.provider';

describe('GivingProviderRegistryService', () => {
  const paystack = {} as PaystackGivingProvider;
  const flutterwave = {} as FlutterwaveGivingProvider;
  const kora = {} as KoraGivingProvider;
  const stripe = {} as StripeGivingProvider;
  let registry: GivingProviderRegistryService;

  beforeEach(() => {
    registry = new GivingProviderRegistryService(
      paystack,
      flutterwave,
      kora,
      stripe,
    );
  });

  it.each([
    ['paystack', () => paystack],
    ['flutterwave', () => flutterwave],
    ['kora', () => kora],
    ['stripe', () => stripe],
  ])('resolves "%s" to the injected instance', (id, getExpected) => {
    expect(registry.get(id)).toBe(getExpected());
  });

  it('throws BadRequestException for an unregistered provider id', () => {
    expect(() => registry.get('korapay-typo')).toThrow(BadRequestException);
  });
});
