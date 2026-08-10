import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaystackPaymentProvider } from '../provider/paystack-payment.provider';
import { FlutterwavePaymentProvider } from '../provider/flutterwave-payment.provider';
import { KoraPaymentProvider } from '../provider/kora-payment.provider';
import {
  FLUTTERWAVE_PROVIDER_NAME,
  IPaymentProvider,
  KORA_PROVIDER_NAME,
  PAYSTACK_PROVIDER_NAME,
} from '../interface/payment-provider.interface';

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

  get(providerName?: string): IPaymentProvider {
    const name = providerName || this.defaultProviderName;
    const provider = this.providers.get(name);
    if (!provider) {
      throw new BadRequestException(
        `Unknown payment provider "${name}". Valid options: ${[...this.providers.keys()].join(', ')}.`,
      );
    }
    return provider;
  }
}
