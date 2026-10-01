import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { ChurchClass } from '../entity/church-class.entity';
import { ClassEnrollment } from '../entity/class-enrollment.entity';
import { EnrollmentStatusEnum } from '../enum/enrollment-status.enum';
import { UtilityService } from '../../utility/service/utility.service';
import { CacheService } from '../../utility/service/cache.service';
import { SmsService } from '../../sms/service/sms.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { buildIcsEvent } from '../../utility/util/ics-builder';
import { ReminderSettingsService } from '../../reminder-settings/service/reminder-settings.service';
import { ReminderSettingKey } from '../../reminder-settings/enum/reminder-setting-key.enum';
import { CHURCH_TIMEZONE } from '../../utility/constants/app.constants';
import { SchedulerGateService } from '../../tenant/scheduler-gate/scheduler-gate.service';
import { ClassSessionService } from '../service/class-session.service';

// Same structure as AssignmentReminderScheduler, keyed per ChurchClass
// instead of per-Assignment — thresholds here are in hours, not days
// (ReminderSettingKey.CLASS_SESSION's defaults are [24, 1]), since a
// meeting reminder is usefully closer to real-time than an assignment
// deadline.
@Injectable()
export class ClassSessionReminderScheduler {
  private static readonly LOCK_KEY = 'lock:class-session-reminders';
  // ChurchClass has no explicit session-duration field (nextSessionAt is a
  // single point in time, not a range) — 1 hour is a reasonable default
  // for the calendar invite's DTEND, not a claim about the class's actual
  // length.
  private static readonly DEFAULT_SESSION_DURATION_MS = 60 * 60 * 1000;
  private readonly logger = new Logger(ClassSessionReminderScheduler.name);

  constructor(
    @InjectRepository(ChurchClass)
    private readonly churchClassRepo: Repository<ChurchClass>,
    @InjectRepository(ClassEnrollment)
    private readonly enrollmentRepo: Repository<ClassEnrollment>,
    private readonly utilityService: UtilityService,
    private readonly cacheService: CacheService,
    private readonly smsService: SmsService,
    private readonly gate: SchedulerGateService,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly reminderSettingsService: ReminderSettingsService,
    private readonly classSessions: ClassSessionService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { timeZone: CHURCH_TIMEZONE })
  async dispatchClassSessionReminders(): Promise<void> {
    const acquired = await this.cacheService.acquireLock(
      ClassSessionReminderScheduler.LOCK_KEY,
      300,
    );
    if (!acquired) return;

    try {
      await this.gate.forEachDueTenant(
        'class-session-reminders',
        this.txHost,
        this.logger,
        () => this.runReminders(),
      );
    } finally {
      this.cacheService.releaseLock(ClassSessionReminderScheduler.LOCK_KEY);
    }
  }

  // Returns when this church next needs a run: the earliest reminder threshold or session start still ahead.
  async runReminders(): Promise<Date | null> {
    const { enabled, thresholds, smsEnabled } =
      await this.reminderSettingsService.getConfig(
        ReminderSettingKey.CLASS_SESSION,
      );
    if (!enabled) return null;

    await this.classSessions.advancePastNextSessions();

    const classes = await this.churchClassRepo
      .createQueryBuilder('c')
      .where('c.next_session_at IS NOT NULL')
      .getMany();

    const now = new Date();

    for (const churchClass of classes) {
      try {
        await this.processClass(churchClass, now, thresholds, smsEnabled);
      } catch (err) {
        this.logger.error(
          `Failed to process class session reminder for class ${churchClass.id}`,
          err,
        );
      }
    }
    return ClassSessionReminderScheduler.nextDue(classes, thresholds, now);
  }

  // A reminder for threshold t goes out on the hourly run where round(hours to go) = t, i.e. the first run after
  // (t + ½) hours before the session; the session start itself is when the class moves on to its next session.
  static nextDue(
    classes: Pick<ChurchClass, 'nextSessionAt'>[],
    thresholds: number[],
    now: Date,
  ): Date | null {
    const hour = 3_600_000;
    const future: number[] = [];
    for (const c of classes) {
      if (!c.nextSessionAt) continue;
      const at = new Date(c.nextSessionAt).getTime();
      for (const when of [
        at,
        ...thresholds.map((t) => at - (t + 0.5) * hour + 1000),
      ])
        if (when > now.getTime()) future.push(when);
    }
    return future.length ? new Date(Math.min(...future)) : null;
  }

  private async processClass(
    churchClass: ChurchClass,
    now: Date,
    thresholds: number[],
    smsEnabled: boolean,
  ): Promise<void> {
    const sessionAt = new Date(churchClass.nextSessionAt!);
    const diffHours = Math.round(
      (sessionAt.getTime() - now.getTime()) / 3_600_000,
    );
    if (!thresholds.includes(diffHours)) return;

    const enrollees = await this.enrollmentRepo.find({
      where: {
        churchClass: { id: churchClass.id },
        status: EnrollmentStatusEnum.IN_PROGRESS,
      },
      relations: ['member', 'guest'],
    });

    // Built once per (class, session) rather than per-enrollee — every
    // recipient gets the same event, and a stable UID keyed on the
    // session's own timestamp means a rescheduled nextSessionAt produces a
    // new calendar entry while repeated reminders (24h, 1h) for the same
    // unchanged session update the one the recipient already has.
    const ics = buildIcsEvent({
      uid: `${churchClass.id}-${sessionAt.getTime()}@classes-session`,
      startTime: sessionAt,
      endTime: new Date(
        sessionAt.getTime() +
          ClassSessionReminderScheduler.DEFAULT_SESSION_DURATION_MS,
      ),
      summary: churchClass.name,
      description: churchClass.meetingLink
        ? `Join: ${churchClass.meetingLink}`
        : `${churchClass.name} session`,
      location: churchClass.meetingLink ?? undefined,
    });

    for (const enrollment of enrollees) {
      await this.remindEnrollment(
        enrollment,
        churchClass,
        diffHours,
        smsEnabled,
        ics,
      );
    }
  }

  private async remindEnrollment(
    enrollment: ClassEnrollment,
    churchClass: ChurchClass,
    diffHours: number,
    smsEnabled: boolean,
    ics: Buffer,
  ): Promise<void> {
    const enrolleeId = enrollment.member?.id ?? enrollment.guest!.id;
    const cacheKey = `class-session-reminder:${churchClass.id}:${enrolleeId}:${diffHours}`;
    const alreadySent = await this.cacheService.get(cacheKey);
    if (alreadySent) return;

    const firstName = UtilityService.capitalizeFirstLetter(
      enrollment.member?.firstname ?? enrollment.guest!.firstName,
    );
    const email = enrollment.member?.email ?? enrollment.guest!.email;
    const phone = enrollment.member?.phoneNumber ?? enrollment.guest?.phone;
    const status = ClassSessionReminderScheduler.statusForDiffHours(diffHours);

    this.utilityService.sendEmailWithAttachment(
      email,
      `${churchClass.name} ${ClassSessionReminderScheduler.subjectLabel(diffHours)}`,
      'class-session-reminder',
      {
        name: firstName,
        className: churchClass.name,
        status,
        statusTitle: ClassSessionReminderScheduler.subjectLabel(diffHours),
        sessionTime: churchClass.nextSessionAt!.toISOString(),
        meetingLink: churchClass.meetingLink,
      },
      [{ filename: 'class-session.ics', content: ics }],
      EmailCategory.CLASS_SESSION_REMINDER,
    );

    if (smsEnabled && phone) {
      void this.smsService
        .send(
          [phone],
          `Reminder: ${churchClass.name} ${status}.${churchClass.meetingLink ? ` Join: ${churchClass.meetingLink}` : ''}`,
          {
            sourceType: 'class_session_reminder',
            sourceId: churchClass.id,
            sourceLabel: churchClass.name,
          },
        )
        .catch((err: unknown) => {
          this.logger.warn(
            `Failed to send class session reminder SMS: ${err instanceof Error ? err.message : err}`,
          );
        });
    }

    this.cacheService.set(cacheKey, '1', 3_600 * 2);
  }

  private static statusForDiffHours(diffHours: number): string {
    if (diffHours <= 0) return 'is starting now';
    if (diffHours === 1) return 'starts in 1 hour';
    if (diffHours < 24) return `starts in ${diffHours} hours`;
    const days = Math.round(diffHours / 24);
    return `starts in ${days} day${days === 1 ? '' : 's'}`;
  }

  private static subjectLabel(diffHours: number): string {
    if (diffHours <= 0) return 'Is Starting Now';
    if (diffHours === 1) return 'Starts in 1 Hour';
    if (diffHours < 24) return `Starts in ${diffHours} Hours`;
    const days = Math.round(diffHours / 24);
    return `Starts in ${days} Day${days === 1 ? '' : 's'}`;
  }
}
