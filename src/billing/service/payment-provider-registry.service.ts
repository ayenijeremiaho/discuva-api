import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaystackPaymentProvider } from '../provider/paystack-payment.provider';
import { FlutterwavePaymentProvider } from '../provider/flutterwave-payment.provider';
import { KoraPaymentProvider } from '../provider/kora-payment.provider';
import {
  FLUTTERWAVE_PROVIDER_NAME,
  IPaymentProvider,
  KORA_PROVIDER_NAME,
  PAYSTACK_PROVIDER_NAME,
} from '../interface/payment-provider.interface';
import { PlatformPaymentProvider } from '../entity/payment-provider.entity';

// Unlike SMS/email (a single platform-default concrete class chosen once at
// boot via an env var — ISmsProvider/IEmailProvider each only ever have one
// implementation registered in this codebase), Paystack, Flutterwave, and
// Kora are all registered simultaneously here — a checkout call picks one
// by name, defaulting to DEFAULT_PAYMENT_PROVIDER when unspecified. See
// KoraPaymentProvider's own class comment for a real capability gap it
// has relative to the other two (no native recurring-subscription API).
@Injectable()
export class PaymentProviderRegistryService {
  private readonly providers: Map<string, IPaymentProvider>;
  private readonly defaultProviderName: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(PlatformPaymentProvider)
    private readonly providerRepo: Repository<PlatformPaymentProvider>,
    paystackPaymentProvider: PaystackPaymentProvider,
    flutterwavePaymentProvider: FlutterwavePaymentProvider,
    koraPaymentProvider: KoraPaymentProvider,
  ) {
    this.providers = new Map<string, IPaymentProvider>([
      [PAYSTACK_PROVIDER_NAME, paystackPaymentProvider],
      [FLUTTERWAVE_PROVIDER_NAME, flutterwavePaymentProvider],
      [KORA_PROVIDER_NAME, koraPaymentProvider],
    ]);
    this.defaultProviderName =
      this.configService.get<string>('DEFAULT_PAYMENT_PROVIDER') ??
      PAYSTACK_PROVIDER_NAME;
  }

  private resolveName(providerName?: string): string {
    return providerName || this.defaultProviderName;
  }

  // Deliberately never checks the DB-backed isActive flag — this is also
  // the path webhook handling, subscription cancellation, and refunds
  // resolve a provider through, and none of those should be blocked by a
  // platform admin deactivating the provider afterward (an already-charged
  // or already-subscribed tenant's in-flight lifecycle must keep working;
  // see CheckoutService.handleWebhookEvent/cancelSubscription/
  // refundCheckoutSession). Only assertActive(), used solely at new
  // subscription-checkout initiation, enforces the flag.
  get(providerName?: string): IPaymentProvider {
    const name = this.resolveName(providerName);
    const provider = this.providers.get(name);
    if (!provider) {
      throw new BadRequestException(
        `Unknown payment provider "${name}". Valid options: ${[...this.providers.keys()].join(', ')}.`,
      );
    }
    return provider;
  }

  // Same "deactivation blocks new usage, not what's already in flight"
  // pattern as CommunicationProvider/GivingProvider — used only by
  // CheckoutService.initiateSubscriptionCheckout.
  async assertActive(providerName?: string): Promise<IPaymentProvider> {
    const name = this.resolveName(providerName);
    const provider = this.get(name);
    const row = await this.providerRepo.findOneBy({ id: name });
    if (row && !row.isActive) {
      throw new BadRequestException(
        `Payment provider "${name}" is temporarily unavailable. Please choose another provider.`,
      );
    }
    return provider;
  }
}
