import { BadRequestException } from '@nestjs/common';
import { SmsProviderRegistryService } from './sms-provider-registry.service';
import { TermiiSmsProvider } from '../provider/termii-sms.provider';
import { TwilioSmsProvider } from '../provider/twilio-sms.provider';

describe('SmsProviderRegistryService', () => {
  const termii = {} as TermiiSmsProvider;
  const twilio = {} as TwilioSmsProvider;
  let registry: SmsProviderRegistryService;

  beforeEach(() => {
    registry = new SmsProviderRegistryService(termii, twilio);
  });

  it('resolves "termii" to the injected TermiiSmsProvider instance', () => {
    expect(registry.get('termii')).toBe(termii);
  });

  it('resolves "twilio" to the injected TwilioSmsProvider instance', () => {
    expect(registry.get('twilio')).toBe(twilio);
  });

  it('throws BadRequestException for an unregistered provider id', () => {
    expect(() => registry.get('africastalking')).toThrow(BadRequestException);
  });
});
