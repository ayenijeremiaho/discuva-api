import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import {
  SmsBalance,
  SmsEncoding,
  SmsLogEntry,
  SmsSendResult,
} from '../interface/sms-provider.interface';
import { SmsProviderRegistryService } from './sms-provider-registry.service';
import { SmsCredentialResolverService } from '../../communication-provider/service/sms-credential-resolver.service';

// Characters Termii documents as forcing UCS-2/unicode encoding (70 chars per
// segment instead of 160) even though some of these are otherwise ordinary
// ASCII punctuation — this list is billing-relevant, not just Unicode-aware.
const GSM7_SPECIAL_CHARS = /[;^{}\\[~\]|€'"]/;

const NOT_CONFIGURED_MESSAGE =
  'No SMS provider configured. Set up your SMS provider under Communication Providers before sending SMS.';

export interface SegmentCalculation {
  segments: number;
  encoding: SmsEncoding;
  characterCount: number;
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    private readonly smsProviderRegistry: SmsProviderRegistryService,
    private readonly credentialResolver: SmsCredentialResolverService,
  ) {}

  calculateSegments(message: string): SegmentCalculation {
    const characterCount = message.length;
    const isGsm7 =
      !GSM7_SPECIAL_CHARS.test(message) && /^[\x00-\x7F]*$/.test(message);
    const encoding: SmsEncoding = isGsm7 ? 'plain' : 'unicode';
    const perSegment = encoding === 'plain' ? 160 : 70;
    const segments =
      characterCount === 0 ? 0 : Math.ceil(characterCount / perSegment);
    return { segments, encoding, characterCount };
  }

  // Pure BYOK — no platform default, no wallet debit. A tenant with no
  // active SMS provider configured simply can't send until they set one up.
  async send(to: string[], message: string): Promise<SmsSendResult[]> {
    const config = await this.credentialResolver.resolveConfig();
    if (!config) {
      throw new ForbiddenException({
        message: NOT_CONFIGURED_MESSAGE,
        code: 'SMS_PROVIDER_NOT_CONFIGURED',
      });
    }

    const provider = this.smsProviderRegistry.get(config.providerId);
    const { encoding } = this.calculateSegments(message);
    const batches = chunk(to, provider.maxRecipientsPerRequest);
    const results: SmsSendResult[] = [];

    for (const batch of batches) {
      try {
        results.push(
          await provider.send(batch, message, encoding, config.credentials),
        );
      } catch (err: any) {
        this.logger.error(
          `SMS batch of ${batch.length} failed: ${err?.message ?? err}`,
        );
      }
    }
    return results;
  }

  async getBalance(): Promise<SmsBalance> {
    const config = await this.credentialResolver.resolveConfig();
    if (!config) {
      throw new ForbiddenException({
        message: NOT_CONFIGURED_MESSAGE,
        code: 'SMS_PROVIDER_NOT_CONFIGURED',
      });
    }
    const provider = this.smsProviderRegistry.get(config.providerId);
    return provider.getBalance(config.credentials);
  }

  async getLogs(): Promise<SmsLogEntry[]> {
    const config = await this.credentialResolver.resolveConfig();
    if (!config) {
      throw new ForbiddenException({
        message: NOT_CONFIGURED_MESSAGE,
        code: 'SMS_PROVIDER_NOT_CONFIGURED',
      });
    }
    const provider = this.smsProviderRegistry.get(config.providerId);
    return provider.getMessageHistory(config.credentials);
  }
}
