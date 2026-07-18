import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PledgeService } from '../service/pledge.service';
import { UtilityService } from '../../utility/service/utility.service';
import { CacheService } from '../../utility/service/cache.service';
import { Pledge } from '../entity/pledge.entity';
import { PledgeFrequency } from '../enum/finance.enum';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { CHURCH_TIMEZONE } from '../../utility/constants/app.constants';

@Injectable()
export class PledgeReminderScheduler {
  private static readonly LOCK_KEY = 'lock:pledge-reminders';
  private readonly logger = new Logger(PledgeReminderScheduler.name);

  constructor(
    private readonly pledgeService: PledgeService,
    private readonly utilityService: UtilityService,
    private readonly cacheService: CacheService,
    private readonly configService: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM, { timeZone: CHURCH_TIMEZONE })
  async dispatchPledgeReminders(): Promise<void> {
    const acquired = await this.cacheService.acquireLock(
      PledgeReminderScheduler.LOCK_KEY,
      300,
    );
    if (!acquired) return;

    try {
      await this.runReminders();
    } finally {
      this.cacheService.releaseLock(PledgeReminderScheduler.LOCK_KEY);
    }
  }

  private async runReminders(): Promise<void> {
    const pledges = await this.pledgeService.findActivePledgesForReminder();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const pledge of pledges) {
      try {
        await this.processPledge(pledge, today);
      } catch (err) {
        this.logger.error(
          `Failed to process pledge reminder for pledge ${pledge.id}`,
          err,
        );
      }
    }
  }

  private async processPledge(pledge: Pledge, today: Date): Promise<void> {
    const dueDate = this.getNextDueDate(
      pledge.startDate,
      pledge.frequency,
      today,
    );
    if (!dueDate) return;

    const diffDays = Math.round(
      (dueDate.getTime() - today.getTime()) / 86_400_000,
    );

    const shouldRemind = diffDays === 7 || diffDays === 0 || diffDays === -3;
    if (!shouldRemind) return;

    const dueDateKey = dueDate.toISOString().slice(0, 10);
    const cacheKey = `pledge-reminder:${pledge.id}:${dueDateKey}:${diffDays}`;
    const alreadySent = await this.cacheService.get(cacheKey);
    if (alreadySent) return;

    const email = pledge.member?.email;
    if (!email) return;

    const isOverdue = diffDays < 0;
    const subject = isOverdue
      ? `Pledge Payment Overdue: ${pledge.campaign?.name}`
      : diffDays === 0
        ? `Pledge Payment Due Today: ${pledge.campaign?.name}`
        : `Pledge Payment Due in 7 Days: ${pledge.campaign?.name}`;

    const loginUrl = this.configService.get<string>('LOGIN_URL');

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
        status: isOverdue
          ? 'overdue'
          : diffDays === 0
            ? 'due today'
            : 'due in 7 days',
        login_url: loginUrl,
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
  ): Date | null {
    const start = new Date(`${startDateStr}T00:00:00`);
    if (start > today) return null;

    if (frequency === PledgeFrequency.ONE_OFF) {
      return start;
    }

    const monthsPerPeriod = frequency === PledgeFrequency.MONTHLY ? 1 : 3;
    let current = new Date(start);

    while (true) {
      const next = new Date(current);
      next.setMonth(next.getMonth() + monthsPerPeriod);
      // stop once we pass 7 days into the future (outside reminder window)
      if (next.getTime() > today.getTime() + 8 * 86_400_000) break;
      current = next;
    }

    return current;
  }
}
