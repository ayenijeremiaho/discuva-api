import { BadRequestException, Injectable } from '@nestjs/common';
import { IGivingProvider } from '../interface/giving-provider.interface';
import { PaystackGivingProvider } from '../provider/paystack-giving.provider';
import { FlutterwaveGivingProvider } from '../provider/flutterwave-giving.provider';
import { KoraGivingProvider } from '../provider/kora-giving.provider';
import { StripeGivingProvider } from '../provider/stripe-giving.provider';

// Same shape as PaymentProviderRegistryService/SmsProviderRegistryService —
// every registered vendor is live simultaneously, GivingCheckoutService
// picks one per tenant by their active TenantGivingProviderConfig.providerId.
// Adding a vendor is a new IGivingProvider class plus a line here and a
// giving_providers catalog row — no other call site changes.
@Injectable()
export class GivingProviderRegistryService {
  private readonly providers: Map<string, IGivingProvider>;

  constructor(
    paystackGivingProvider: PaystackGivingProvider,
    flutterwaveGivingProvider: FlutterwaveGivingProvider,
    koraGivingProvider: KoraGivingProvider,
    stripeGivingProvider: StripeGivingProvider,
  ) {
    this.providers = new Map<string, IGivingProvider>([
      ['paystack', paystackGivingProvider],
      ['flutterwave', flutterwaveGivingProvider],
      ['kora', koraGivingProvider],
      ['stripe', stripeGivingProvider],
    ]);
  }

  get(providerId: string): IGivingProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new BadRequestException(
        `Unknown giving provider "${providerId}". Valid options: ${[...this.providers.keys()].join(', ')}.`,
      );
    }
    return provider;
  }
}
