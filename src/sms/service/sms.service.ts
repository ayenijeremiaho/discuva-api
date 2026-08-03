import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ISmsProvider,
  SMS_PROVIDER,
  SmsBalance,
  SmsEncoding,
  SmsLogEntry,
  SmsSendResult,
} from '../interface/sms-provider.interface';
import { TERMII_MAX_RECIPIENTS_PER_REQUEST } from '../provider/termii-sms.provider';
import { SmsCredentialResolverService } from '../../communication-provider/service/sms-credential-resolver.service';

// Characters Termii documents as forcing UCS-2/unicode encoding (70 chars per
// segment instead of 160) even though some of these are otherwise ordinary
// ASCII punctuation — this list is billing-relevant, not just Unicode-aware.
const GSM7_SPECIAL_CHARS = /[;^{}\\[~\]|€'"]/;

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
    @Inject(SMS_PROVIDER) private readonly provider: ISmsProvider,
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

  // Whether a tenant's own BYOK credentials (their own Termii account, no
  // wallet involved) or this platform's default (billed against the
  // tenant's prepaid SmsWallet, one debit per batch actually attempted) get
  // used is resolved once per send — not per recipient, per message.
  async send(to: string[], message: string): Promise<SmsSendResult[]> {
    const { segments, encoding } = this.calculateSegments(message);
    const credentials = await this.credentialResolver.resolveCredentials();
    const batches = chunk(to, TERMII_MAX_RECIPIENTS_PER_REQUEST);
    const results: SmsSendResult[] = [];
    const reference = randomUUID();

    for (const batch of batches) {
      try {
        if (!credentials) {
          await this.credentialResolver.debitForSend(
            segments * batch.length,
            reference,
          );
        }
        results.push(
          await this.provider.send(batch, message, encoding, credentials),
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
    const credentials = await this.credentialResolver.resolveCredentials();
    return this.provider.getBalance(credentials);
  }

  async getLogs(): Promise<SmsLogEntry[]> {
    const credentials = await this.credentialResolver.resolveCredentials();
    return this.provider.getMessageHistory(credentials);
  }
}
