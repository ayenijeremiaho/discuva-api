import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from './cache.service';

export type UsageChannel = 'email' | 'push' | 'sms';
export type UsageOutcome =
  'sent' | 'failed' | 'limited' | 'off' | 'no_provider';
export type UsageCounts = Record<string, number>;

// Types beyond EmailCategory: uncategorised account emails, and messages an admin writes.
export const ACCOUNT_USAGE = 'ACCOUNT';
export const ANNOUNCEMENT_USAGE = 'ANNOUNCEMENTS';

const KEEP_SECONDS = 14 * 31 * 24 * 60 * 60;

export const usageField = (
  channel: UsageChannel,
  type: string,
  outcome: UsageOutcome,
): string => `${channel}:${type}:${outcome}`;

// One Redis hash per church per month, so counting never adds a database write to a send.
@Injectable()
export class NotificationUsageService {
  private readonly logger = new Logger(NotificationUsageService.name);

  constructor(private readonly cacheService: CacheService) {}

  record(
    channel: UsageChannel,
    type: string,
    outcome: UsageOutcome,
    count = 1,
  ): void {
    if (count < 1) return;
    this.cacheService
      .hashIncr(
        this.key(new Date()),
        usageField(channel, type, outcome),
        KEEP_SECONDS,
        count,
      )
      .catch((err: Error) =>
        this.logger.warn(`Could not count notification: ${err.message}`),
      );
  }

  async forMonth(date: Date): Promise<UsageCounts> {
    const raw = await this.cacheService.hashGetAll(this.key(date));
    return Object.fromEntries(
      Object.entries(raw).map(([field, n]) => [field, Number(n)]),
    );
  }

  private key(date: Date): string {
    return `notification-usage:${date.toISOString().slice(0, 7)}`;
  }
}
