import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import {
  SmsBalance,
  SmsEncoding,
  SmsLogEntry,
  SmsSendResult,
} from '../interface/sms-provider.interface';
import { SmsProviderRegistryService } from './sms-provider-registry.service';
import {
  ResolvedSmsConfig,
  SmsCredentialResolverService,
} from '../../communication-provider/service/sms-credential-resolver.service';
import { CHURCH_TIMEZONE } from '../../utility/constants/app.constants';

// Characters Termii documents as forcing UCS-2/unicode encoding (70 chars per
// segment instead of 160) even though some of these are otherwise ordinary
// ASCII punctuation — this list is billing-relevant, not just Unicode-aware.
const GSM7_SPECIAL_CHARS = /[;^{}\\[~\]|€'"]/;

const NOT_CONFIGURED_MESSAGE =
  'No SMS provider configured. Set up your SMS provider under Communication Providers before sending SMS.';
const SMS_SEND_WINDOW_START_MINUTE = 8 * 60;
const SMS_SEND_WINDOW_END_MINUTE = 19 * 60 + 50;

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

  private async resolveConfigOrThrow(): Promise<ResolvedSmsConfig> {
    const config = await this.credentialResolver.resolveConfig();
    if (!config) {
      throw new ForbiddenException({
        message: NOT_CONFIGURED_MESSAGE,
        code: 'SMS_PROVIDER_NOT_CONFIGURED',
      });
    }
    return config;
  }

  // Lets a caller (e.g. AnnouncementService, before persisting an
  // announcement that implies an SMS will follow) check upfront rather
  // than discovering the failure only once send() is actually called —
  // same NOT_CONFIGURED_MESSAGE/code as every other method here.
  async assertConfigured(): Promise<void> {
    await this.resolveConfigOrThrow();
  }

  // Pure BYOK — no platform default, no wallet debit. A tenant with no
  // active SMS provider configured simply can't send until they set one up.
  async send(to: string[], message: string): Promise<SmsSendResult[]> {
    this.assertSendingWindowOpen();
    const config = await this.resolveConfigOrThrow();

    const provider = this.smsProviderRegistry.get(config.providerId);
    const { encoding } = this.calculateSegments(message);
    const batches = chunk(to, provider.maxRecipientsPerRequest);
    const results: SmsSendResult[] = [];
    const failures: string[] = [];

    for (const batch of batches) {
      try {
        results.push(
          await provider.send(batch, message, encoding, config.credentials),
        );
      } catch (err: any) {
        const message = err?.message ?? String(err);
        this.logger.error(`SMS batch of ${batch.length} failed: ${message}`);
        failures.push(message);
      }
    }

    if (failures.length > 0) {
      throw new InternalServerErrorException({
        message: `SMS provider request failed: ${failures.join('; ')}. Provider acceptance may be partial; check provider history before retrying.`,
        code: 'SMS_SEND_FAILED',
      });
    }

    return results;
  }

  private assertSendingWindowOpen(now = new Date()): void {
    const timeParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: CHURCH_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const hour = Number(timeParts.find((part) => part.type === 'hour')?.value);
    const minute = Number(
      timeParts.find((part) => part.type === 'minute')?.value,
    );
    const minuteOfDay = hour * 60 + minute;

    if (
      minuteOfDay < SMS_SEND_WINDOW_START_MINUTE ||
      minuteOfDay > SMS_SEND_WINDOW_END_MINUTE
    ) {
      throw new BadRequestException({
        message: `SMS sending is available from 8:00am to 7:50pm (${CHURCH_TIMEZONE}).`,
        code: 'SMS_SEND_WINDOW_CLOSED',
      });
    }
  }

  async getBalance(): Promise<SmsBalance> {
    const config = await this.resolveConfigOrThrow();
    const provider = this.smsProviderRegistry.get(config.providerId);
    return provider.getBalance(config.credentials);
  }

  async getLogs(): Promise<SmsLogEntry[]> {
    const config = await this.resolveConfigOrThrow();
    const provider = this.smsProviderRegistry.get(config.providerId);
    const history = await provider.getMessageHistory(config.credentials);
    return history.map((entry) => ({ ...entry, provider: config.providerId }));
  }
}
