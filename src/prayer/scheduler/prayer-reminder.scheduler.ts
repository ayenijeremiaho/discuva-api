import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { PrayerRosterEntry } from '../entity/prayer-roster-entry.entity';
import { PrayerMeetingStatus, PrayerRosterStatus } from '../enum/prayer.enum';
import { UtilityService } from '../../utility/service/utility.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';
import { CHURCH_TIMEZONE } from '../../utility/constants/app.constants';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { forEachActiveTenant } from '../../tenant/utility/for-each-active-tenant';

@Injectable()
export class PrayerReminderScheduler {
  private readonly logger = new Logger(PrayerReminderScheduler.name);

  constructor(
    @InjectRepository(PrayerRosterEntry)
    private readonly rosterRepo: Repository<PrayerRosterEntry>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly utilityService: UtilityService,
    private readonly pushService: PushNotificationService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM, { timeZone: CHURCH_TIMEZONE })
  async sendReminders(): Promise<void> {
    const today = new Date();
    const twoDaysAhead = new Date(today);
    twoDaysAhead.setDate(today.getDate() + 2);

    const { succeeded, failed } = await forEachActiveTenant(
      this.tenantRepo,
      this.cls,
      this.txHost,
      this.logger,
      async () => {
        await this.sendTwoDayReminders(twoDaysAhead);
        await this.sendDayOfReminders(today);
      },
    );
    this.logger.log(
      `Prayer reminders complete for ${succeeded} tenant(s), ${failed} failure(s)`,
    );
  }

  private async sendTwoDayReminders(targetDate: Date): Promise<void> {
    const entries = await this.rosterRepo.find({
      where: {
        meeting: {
          date: this.toDateStr(targetDate),
          status: PrayerMeetingStatus.SCHEDULED,
        },
        status: PrayerRosterStatus.SCHEDULED,
        reminderTwoDaySent: false,
      },
      relations: [
        'workerProfile',
        'workerProfile.member',
        'meeting',
        'meeting.dayConfig',
      ],
    });

    for (const entry of entries) {
      try {
        this.queueReminder(entry, 'two-day');
      } catch (err) {
        this.logger.error(
          `Failed to queue 2-day reminder for entry ${entry.id}: ${err}`,
        );
      }
      entry.reminderTwoDaySent = true;
    }

    if (entries.length) await this.rosterRepo.save(entries);
  }

  private async sendDayOfReminders(targetDate: Date): Promise<void> {
    const entries = await this.rosterRepo.find({
      where: {
        meeting: {
          date: this.toDateStr(targetDate),
          status: PrayerMeetingStatus.SCHEDULED,
        },
        status: PrayerRosterStatus.SCHEDULED,
        reminderDaySent: false,
      },
      relations: [
        'workerProfile',
        'workerProfile.member',
        'meeting',
        'meeting.dayConfig',
      ],
    });

    for (const entry of entries) {
      try {
        this.queueReminder(entry, 'day-of');
      } catch (err) {
        this.logger.error(
          `Failed to queue day-of reminder for entry ${entry.id}: ${err}`,
        );
      }
      entry.reminderDaySent = true;
    }

    if (entries.length) await this.rosterRepo.save(entries);
  }

  private queueReminder(
    entry: PrayerRosterEntry,
    type: 'two-day' | 'day-of',
  ): void {
    const member = entry.workerProfile.member;
    const dayConfig = entry.meeting.dayConfig;
    const subject =
      type === 'two-day'
        ? 'Prayer Meeting Reminder — 2 Days Away'
        : 'Prayer Meeting Reminder — Today';

    this.utilityService.sendEmailWithTemplate(
      member.email,
      subject,
      'prayer-reminder',
      {
        name: member.firstname,
        meeting_date: entry.meeting.date,
        start_time: dayConfig.startTime,
        end_time: dayConfig.endTime,
        mode: dayConfig.mode,
        is_two_day: type === 'two-day',
      },
      undefined,
      EmailCategory.PRAYER_REMINDER,
    );

    this.pushService.dispatchToMemberIds([member.id], {
      idempotencyKey: `prayer-reminder-${type}:${entry.id}`,
      title: subject,
      body: `Your prayer meeting is on ${entry.meeting.date} at ${dayConfig.startTime}.`,
      url: '/prayer',
    });
  }

  private toDateStr(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
}
