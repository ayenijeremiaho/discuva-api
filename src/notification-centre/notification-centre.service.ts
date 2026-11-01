import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../tenant/interface/tenant-cls-store.interface';
import { queryTenant } from '../tenant/utility/query-tenant';
import { EmailCategorySettingsService } from '../email-category-settings/service/email-category-settings.service';
import { ReminderSettingsService } from '../reminder-settings/service/reminder-settings.service';
import { EmailAllowanceService } from '../utility/service/email-allowance.service';
import { CacheService } from '../utility/service/cache.service';
import {
  ACCOUNT_USAGE,
  ANNOUNCEMENT_USAGE,
  NotificationUsageService,
  UsageChannel,
  UsageCounts,
  UsageOutcome,
  usageField,
} from '../utility/service/notification-usage.service';
import { EMAIL_CATALOGUE } from '../notification-catalogue/email-catalogue';
import { PUSH_CATALOGUE } from '../notification-catalogue/push-catalogue';
import { SmsCredentialResolverService } from '../communication-provider/service/sms-credential-resolver.service';
import { SmsService } from '../sms/service/sms.service';
import { SmsBalance } from '../sms/interface/sms-provider.interface';
import { EmailCategory } from '../utility/email-provider/email-category.enum';
import {
  NOTIFICATION_GROUPS,
  SMS_REMINDER_KEYS,
} from './notification-centre.constant';

const OPT_OUTS_TTL_SECONDS = 300;
const BALANCE_TIMEOUT_MS = 3000;

// What each type contains, from the catalogues, so new messages list themselves.
function includedMessages(): Map<string, string[]> {
  const included = new Map<string, Set<string>>();
  const add = (type: string, label: string) =>
    included.set(type, (included.get(type) ?? new Set()).add(label));
  for (const t of Object.values(EMAIL_CATALOGUE)) {
    add(t.category ?? ACCOUNT_USAGE, t.label);
  }
  for (const t of Object.values(PUSH_CATALOGUE)) add(t.category, t.label);
  return new Map([...included].map(([type, set]) => [type, [...set].sort()]));
}

const INCLUDED = includedMessages();

export type ChannelUsage = Partial<Record<UsageOutcome, number>>;
export type TypeUsage = Record<UsageChannel, ChannelUsage>;

function usageOf(type: string, counts: UsageCounts): TypeUsage {
  const outcomes: UsageOutcome[] = [
    'sent',
    'failed',
    'limited',
    'off',
    'no_provider',
  ];
  const channel = (c: UsageChannel): ChannelUsage =>
    Object.fromEntries(
      outcomes
        .map((o) => [o, counts[usageField(c, type, o)] ?? 0] as const)
        .filter(([, n]) => n > 0),
    );
  return {
    email: channel('email'),
    push: channel('push'),
    sms: channel('sms'),
  };
}

function totalsOf(counts: UsageCounts): Record<UsageChannel, number> {
  const sum = (c: UsageChannel) =>
    Object.entries(counts)
      .filter(([f]) => f.startsWith(`${c}:`) && f.endsWith(':sent'))
      .reduce((n, [, v]) => n + v, 0);
  return { email: sum('email'), push: sum('push'), sms: sum('sms') };
}

@Injectable()
export class NotificationCentreService {
  private readonly logger = new Logger(NotificationCentreService.name);

  constructor(
    private readonly categories: EmailCategorySettingsService,
    private readonly reminders: ReminderSettingsService,
    private readonly usage: NotificationUsageService,
    private readonly allowance: EmailAllowanceService,
    private readonly smsCredentials: SmsCredentialResolverService,
    private readonly sms: SmsService,
    private readonly cacheService: CacheService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async overview() {
    const now = new Date();
    const lastMonthDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );
    const [settings, reminders, thisMonth, lastMonth, optOuts, limit, sms] =
      await Promise.all([
        this.categories.findAll(),
        this.reminders.findAll(),
        this.usage.forMonth(now),
        this.usage.forMonth(lastMonthDate),
        this.optOutCounts(),
        this.allowance.status(),
        this.smsStatus(),
      ]);

    const smsOn = new Map(reminders.map((r) => [r.key, r.smsEnabled]));
    const types = settings.map((s) => {
      const smsReminderKey =
        SMS_REMINDER_KEYS[s.category as EmailCategory] ?? null;
      return {
        ...s,
        group: NOTIFICATION_GROUPS[s.category as EmailCategory],
        includes: INCLUDED.get(s.category) ?? [],
        smsReminderKey,
        smsEnabled: smsReminderKey ? !!smsOn.get(smsReminderKey) : false,
        optedOut: optOuts[s.category] ?? 0,
        usage: usageOf(s.category, thisMonth),
        lastMonth: usageOf(s.category, lastMonth),
      };
    });

    return {
      month: now.toISOString().slice(0, 7),
      lastMonth: lastMonthDate.toISOString().slice(0, 7),
      totals: totalsOf(thisMonth),
      lastMonthTotals: totalsOf(lastMonth),
      types,
      // Not switchable, so listed apart from the types above.
      fixedTypes: [
        {
          category: ACCOUNT_USAGE,
          label: 'Account emails',
          description:
            'Password resets, sign-in codes and other account messages. Always sent.',
          includes: INCLUDED.get(ACCOUNT_USAGE) ?? [],
          usage: usageOf(ACCOUNT_USAGE, thisMonth),
          lastMonth: usageOf(ACCOUNT_USAGE, lastMonth),
        },
        {
          category: ANNOUNCEMENT_USAGE,
          label: 'Announcements',
          description:
            'Messages your admins write and send on purpose, by push or text.',
          includes: [],
          usage: usageOf(ANNOUNCEMENT_USAGE, thisMonth),
          lastMonth: usageOf(ANNOUNCEMENT_USAGE, lastMonth),
        },
      ],
      blocks: {
        emailLimit: limit
          ? {
              ...limit,
              reachedToday: limit.usedToday > limit.limit,
              stoppedThisMonth: this.sumOutcome(thisMonth, 'email', 'limited'),
            }
          : null,
        sms: {
          ...sms,
          textRemindersOn: types.some((t) => t.smsEnabled),
          stoppedThisMonth: this.sumOutcome(thisMonth, 'sms', 'no_provider'),
        },
      },
    };
  }

  private sumOutcome(
    counts: UsageCounts,
    channel: UsageChannel,
    outcome: UsageOutcome,
  ): number {
    return Object.entries(counts)
      .filter(([f]) => f.startsWith(`${channel}:`) && f.endsWith(`:${outcome}`))
      .reduce((n, [, v]) => n + v, 0);
  }

  // Only the page reads this; cached, because it counts across all members.
  private optOutCounts(): Promise<Record<string, number>> {
    return this.cacheService.getOrSet(
      'notification-centre:opt-outs',
      async () => {
        const rows = await queryTenant<{ category: string; count: string }>(
          this.dataSource,
          this.cls.get('schemaName'),
          (schema) =>
            `SELECT unnest(muted_notifications) AS category, COUNT(*) AS count FROM ${schema}.members GROUP BY 1`,
        );
        return Object.fromEntries(
          rows.map((r) => [r.category, Number(r.count)]),
        );
      },
      OPT_OUTS_TTL_SECONDS,
    );
  }

  private async smsStatus(): Promise<{
    providerConfigured: boolean;
    balance: SmsBalance | null;
  }> {
    if (!(await this.smsCredentials.resolveConfig())) {
      return { providerConfigured: false, balance: null };
    }
    let timer: NodeJS.Timeout | undefined;
    // A slow provider shouldn't hold up the page.
    const balance = await Promise.race([
      this.sms.getBalance(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), BALANCE_TIMEOUT_MS);
      }),
    ])
      .catch((err: Error) => {
        this.logger.warn(`SMS balance unavailable: ${err.message}`);
        return null;
      })
      .finally(() => clearTimeout(timer));
    return { providerConfigured: true, balance };
  }
}
