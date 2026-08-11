import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { PledgeService } from '../service/pledge.service';
import { UtilityService } from '../../utility/service/utility.service';
import { CacheService } from '../../utility/service/cache.service';
import { Pledge } from '../entity/pledge.entity';
import { PledgeFrequency } from '../enum/finance.enum';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { ReminderSettingsService } from '../../reminder-settings/service/reminder-settings.service';
import { ReminderSettingKey } from '../../reminder-settings/enum/reminder-setting-key.enum';
import { CHURCH_TIMEZONE } from '../../utility/constants/app.constants';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { forEachActiveTenant } from '../../tenant/utility/for-each-active-tenant';

@Injectable()
export class PledgeReminderScheduler {
  private static readonly LOCK_KEY = 'lock:pledge-reminders';
  private readonly logger = new Logger(PledgeReminderScheduler.name);

  constructor(
    private readonly pledgeService: PledgeService,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly utilityService: UtilityService,
    private readonly cacheService: CacheService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly reminderSettingsService: ReminderSettingsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM, { timeZone: CHURCH_TIMEZONE })
  async dispatchPledgeReminders(): Promise<void> {
    const acquired = await this.cacheService.acquireLock(
      PledgeReminderScheduler.LOCK_KEY,
      300,
    );
    if (!acquired) return;

    try {
      await forEachActiveTenant(
        this.tenantRepo,
        this.cls,
        this.txHost,
        this.logger,
        () => this.runReminders(),
      );
    } finally {
      this.cacheService.releaseLock(PledgeReminderScheduler.LOCK_KEY);
    }
  }

  private async runReminders(): Promise<void> {
    const { enabled, thresholds } =
      await this.reminderSettingsService.getConfig(
        ReminderSettingKey.PLEDGE_REMINDER,
      );
    if (!enabled) return;

    const pledges = await this.pledgeService.findActivePledgesForReminder();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const pledge of pledges) {
      try {
        await this.processPledge(pledge, today, thresholds);
      } catch (err) {
        this.logger.error(
          `Failed to process pledge reminder for pledge ${pledge.id}`,
          err,
        );
      }
    }
  }

  private async processPledge(
    pledge: Pledge,
    today: Date,
    thresholds: number[],
  ): Promise<void> {
    const maxLookaheadDays = Math.max(0, ...thresholds);
    const dueDate = this.getNextDueDate(
      pledge.startDate,
      pledge.frequency,
      today,
      maxLookaheadDays,
    );
    if (!dueDate) return;

    const diffDays = Math.round(
      (dueDate.getTime() - today.getTime()) / 86_400_000,
    );

    if (!thresholds.includes(diffDays)) return;

    const dueDateKey = dueDate.toISOString().slice(0, 10);
    const cacheKey = `pledge-reminder:${pledge.id}:${dueDateKey}:${diffDays}`;
    const alreadySent = await this.cacheService.get(cacheKey);
    if (alreadySent) return;

    const email = pledge.member?.email;
    if (!email) return;

    const status = PledgeReminderScheduler.statusForDiffDays(diffDays);
    const subject = `Pledge Payment ${PledgeReminderScheduler.subjectLabel(diffDays)}: ${pledge.campaign?.name}`;

    this.utilityService.sendEmailWithTemplate(
      email,
      subject,
      'pledge-reminder',
      {
        name: UtilityService.capitalizeFirstLetter(pledge.member.firstname),
        campaignName: pledge.campaign?.name ?? 'your pledge campaign',
        frequency: pledge.frequency,
        totalAmount: Number(pledge.totalAmount).toLocaleString(),
        dueDate: dueDateKey,
        status,
      },
      undefined,
      EmailCategory.FINANCE_ALERTS,
    );

    this.cacheService.set(cacheKey, '1', 86_400 * 2);
  }

  private getNextDueDate(
    startDateStr: string,
    frequency: PledgeFrequency,
    today: Date,
    maxLookaheadDays: number,
  ): Date | null {
    const start = new Date(`${startDateStr}T00:00:00`);
    if (start > today) return null;

    if (frequency === PledgeFrequency.ONE_OFF) {
      return start;
    }

    const monthsPerPeriod = frequency === PledgeFrequency.MONTHLY ? 1 : 3;
    const lookaheadMs = (maxLookaheadDays + 1) * 86_400_000;
    let current = new Date(start);

    while (true) {
      const next = new Date(current);
      next.setMonth(next.getMonth() + monthsPerPeriod);
      // stop once we pass the furthest configured reminder threshold
      if (next.getTime() > today.getTime() + lookaheadMs) break;
      current = next;
    }

    return current;
  }

  private static statusForDiffDays(diffDays: number): string {
    if (diffDays < 0) {
      const days = Math.abs(diffDays);
      return `overdue by ${days} day${days === 1 ? '' : 's'}`;
    }
    if (diffDays === 0) return 'due today';
    return `due in ${diffDays} day${diffDays === 1 ? '' : 's'}`;
  }

  private static subjectLabel(diffDays: number): string {
    if (diffDays < 0) {
      const days = Math.abs(diffDays);
      return `Overdue by ${days} Day${days === 1 ? '' : 's'}`;
    }
    if (diffDays === 0) return 'Due Today';
    return `Due in ${diffDays} Day${diffDays === 1 ? '' : 's'}`;
  }
}
