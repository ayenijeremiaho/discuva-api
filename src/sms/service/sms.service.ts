import {
  BadRequestException,
  ForbiddenException,
  Injectable,
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
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SmsDeliveryLog } from '../entity/sms-delivery-log.entity';

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

export interface SmsSendContext {
  sourceType?: string;
  sourceId?: string;
  sourceLabel?: string;
}

export interface SmsSendOutcome {
  acceptedCount: number;
  failedCount: number;
  failures: string[];
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

function normalizePhoneNumber(phone: string): string {
  return phone.replace(/\D/g, '');
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    private readonly smsProviderRegistry: SmsProviderRegistryService,
    private readonly credentialResolver: SmsCredentialResolverService,
    @InjectRepository(SmsDeliveryLog)
    private readonly deliveryLogRepo: Repository<SmsDeliveryLog>,
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
  async send(
    to: string[],
    message: string,
    context: SmsSendContext = {},
  ): Promise<SmsSendOutcome> {
    const config = await this.resolveConfigOrThrow();

    const provider = this.smsProviderRegistry.get(config.providerId);
    const { encoding } = this.calculateSegments(message);
    const batches = chunk(to, provider.maxRecipientsPerRequest);
    const failures: string[] = [];
    let acceptedCount = 0;

    for (const batch of batches) {
      const logs = batch.map((recipient) =>
        this.deliveryLogRepo.create({
          provider: config.providerId,
          recipient,
          message,
          status: 'PENDING',
          providerMessageId: null,
          providerStatus: null,
          errorMessage: null,
          sourceType: context.sourceType ?? 'direct',
          sourceId: context.sourceId ?? null,
          sourceLabel: context.sourceLabel ?? null,
        }),
      );
      await this.deliveryLogRepo.save(logs);

      try {
        this.assertSendingWindowOpen();
        const result: SmsSendResult = await provider.send(
          batch,
          message,
          encoding,
          config.credentials,
        );
        const messageIds = result.messageId.split(',');
        logs.forEach((log, index) => {
          log.status = 'ACCEPTED';
          log.providerStatus = result.status;
          log.providerMessageId =
            messageIds.length === batch.length
              ? messageIds[index]
              : result.messageId || null;
        });
        await this.deliveryLogRepo.save(logs);
        acceptedCount += batch.length;
      } catch (err: any) {
        const message = err?.message ?? String(err);
        this.logger.error(`SMS batch of ${batch.length} failed: ${message}`);
        failures.push(message);
        logs.forEach((log) => {
          log.status = 'FAILED';
          log.errorMessage = message;
        });
        await this.deliveryLogRepo.save(logs);
      }
    }

    return { acceptedCount, failedCount: to.length - acceptedCount, failures };
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
    const [history, localLogs] = await Promise.all([
      provider.getMessageHistory(config.credentials).catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : JSON.stringify(error);
        this.logger.warn(`SMS provider history unavailable: ${message}`);
        return [];
      }),
      this.deliveryLogRepo.find({
        where: { provider: config.providerId },
        order: { createdAt: 'DESC' },
        take: 500,
      }),
    ]);
    const matchedIds = new Set<string>();
    const providerLogs = history.map((entry) => {
      const local = localLogs.find(
        (log) =>
          !matchedIds.has(log.id) &&
          log.providerMessageId === entry.messageId &&
          normalizePhoneNumber(log.recipient) ===
            normalizePhoneNumber(entry.recipient),
      );
      if (local) matchedIds.add(local.id);
      return {
        ...entry,
        provider: config.providerId,
        dispatchStatus: local?.status,
        errorMessage: local?.errorMessage ?? undefined,
        sourceType: local?.sourceType,
        sourceId: local?.sourceId ?? undefined,
        sourceLabel: local?.sourceLabel ?? undefined,
        trackingId: local?.id,
      };
    });
    const unlinkedLogs = localLogs
      .filter((log) => !matchedIds.has(log.id))
      .map((log) => ({
        messageId: log.providerMessageId ?? log.id,
        recipient: log.recipient,
        message: log.message,
        status: log.providerStatus ?? log.status,
        type: config.providerId === 'termii' ? 'sms' : 'outbound',
        sentAt: log.createdAt.toISOString(),
        provider: config.providerId,
        dispatchStatus: log.status,
        errorMessage: log.errorMessage ?? undefined,
        sourceType: log.sourceType,
        sourceId: log.sourceId ?? undefined,
        sourceLabel: log.sourceLabel ?? undefined,
        trackingId: log.id,
      }));

    return [...providerLogs, ...unlinkedLogs].sort(
      (left, right) =>
        new Date(right.sentAt).getTime() - new Date(left.sentAt).getTime(),
    );
  }
}
