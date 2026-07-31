import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ISmsProvider,
  SMS_PROVIDER,
  SmsBalance,
  SmsEncoding,
  SmsLogEntry,
  SmsSendResult,
} from '../interface/sms-provider.interface';
import { TERMII_MAX_RECIPIENTS_PER_REQUEST } from '../provider/termii-sms.provider';

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

  constructor(@Inject(SMS_PROVIDER) private readonly provider: ISmsProvider) {}

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

  async send(to: string[], message: string): Promise<SmsSendResult[]> {
    const { encoding } = this.calculateSegments(message);
    const batches = chunk(to, TERMII_MAX_RECIPIENTS_PER_REQUEST);
    const results: SmsSendResult[] = [];
    for (const batch of batches) {
      try {
        results.push(await this.provider.send(batch, message, encoding));
      } catch (err: any) {
        this.logger.error(
          `SMS batch of ${batch.length} failed: ${err?.message ?? err}`,
        );
      }
    }
    return results;
  }

  async getBalance(): Promise<SmsBalance> {
    return this.provider.getBalance();
  }

  async getLogs(): Promise<SmsLogEntry[]> {
    return this.provider.getMessageHistory();
  }
}
