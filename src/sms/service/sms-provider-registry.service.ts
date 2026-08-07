import { BadRequestException, Injectable } from '@nestjs/common';
import { ISmsProvider } from '../interface/sms-provider.interface';
import { TermiiSmsProvider } from '../provider/termii-sms.provider';
import { TwilioSmsProvider } from '../provider/twilio-sms.provider';

// Same shape as PaymentProviderRegistryService — every registered vendor is
// live simultaneously, SmsService picks one per tenant by their active
// TenantCommunicationProviderConfig.providerId (resolved via
// SmsCredentialResolverService). Adding a vendor is a new ISmsProvider class
// plus a line here and a communication_providers catalog row — no other
// call site changes.
@Injectable()
export class SmsProviderRegistryService {
  private readonly providers: Map<string, ISmsProvider>;

  constructor(
    termiiSmsProvider: TermiiSmsProvider,
    twilioSmsProvider: TwilioSmsProvider,
  ) {
    this.providers = new Map<string, ISmsProvider>([
      ['termii', termiiSmsProvider],
      ['twilio', twilioSmsProvider],
    ]);
  }

  get(providerId: string): ISmsProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new BadRequestException(
        `Unknown SMS provider "${providerId}". Valid options: ${[...this.providers.keys()].join(', ')}.`,
      );
    }
    return provider;
  }
}
