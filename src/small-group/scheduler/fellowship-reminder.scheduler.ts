import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { SmallGroup } from '../entity/small-group.entity';
import { SmallGroupMember } from '../entity/small-group-member.entity';
import { MeetingFrequencyEnum } from '../enum/meeting-frequency.enum';
import { Member } from '../../member/entity/member.entity';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { MeetingFormatEnum } from '../../utility/enum/meeting-format.enum';
import { SchedulerGateService } from '../../tenant/scheduler-gate/scheduler-gate.service';
import { CacheService } from '../../utility/service/cache.service';
import { ReminderSettingsService } from '../../reminder-settings/service/reminder-settings.service';
import { ReminderSettingKey } from '../../reminder-settings/enum/reminder-setting-key.enum';
import { ChurchSettingsService } from '../../church-settings/service/church-settings.service';
import { ChurchTimezoneService } from '../../utility/service/church-timezone.service';
import { DateService } from '../../utility/service/date.service';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';
import { localDate, addDays } from '../../event/types/slot-blueprint';
import { nextMeeting } from '../util/meeting-schedule';
import { scheduleOf } from '../service/small-group.service';

const HOUR_MS = 3_600_000;
// Long enough to outlast every threshold for one meeting.
const SENT_TTL_SECONDS = 8 * 24 * 3600;

interface DueReminder {
  group: SmallGroup;
  at: Date;
  hours: number;
}

// Reminds a fellowship's members and leader before each meeting, at the hours the church chose (Reminder Settings).
@Injectable()
export class FellowshipReminderScheduler {
  private static readonly LOCK_KEY = 'lock:fellowship-reminders';
  private readonly logger = new Logger(FellowshipReminderScheduler.name);

  constructor(
    @InjectRepository(SmallGroup)
    private readonly groupRepo: Repository<SmallGroup>,
    @InjectRepository(SmallGroupMember)
    private readonly memberRepo: Repository<SmallGroupMember>,
    private readonly gate: SchedulerGateService,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly cacheService: CacheService,
    private readonly reminderSettings: ReminderSettingsService,
    private readonly churchSettings: ChurchSettingsService,
    private readonly churchTimezone: ChurchTimezoneService,
    private readonly dateService: DateService,
    private readonly notificationDispatchService: NotificationDispatchService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async dispatchFellowshipReminders(): Promise<void> {
    if (
      !(await this.cacheService.acquireLock(
        FellowshipReminderScheduler.LOCK_KEY,
        300,
      ))
    )
      return;
    try {
      await this.gate.forEachDueTenant(
        'fellowship-reminders',
        this.txHost,
        this.logger,
        () => this.runReminders(),
      );
    } finally {
      this.cacheService.releaseLock(FellowshipReminderScheduler.LOCK_KEY);
    }
  }

  // Returns when this church next needs a run (null when reminders are off or nothing is scheduled).
  async runReminders(now = new Date()): Promise<Date | null> {
    if (!(await this.churchSettings.isEnabled('small_groups'))) return null;
    const { enabled, thresholds } = await this.reminderSettings.getConfig(
      ReminderSettingKey.FELLOWSHIP_MEETING,
    );
    if (!enabled || !thresholds.length) return null;

    const timezone = await this.churchTimezone.get();
    const groups = await this.groupRepo.find({
      where: { meetingFrequency: Not(MeetingFrequencyEnum.NONE) },
      relations: ['leader', 'venue'],
    });
    const meetings: Date[] = [];
    const due: DueReminder[] = [];
    for (const group of groups) {
      const at = nextMeeting(scheduleOf(group), now, timezone);
      if (!at) continue;
      meetings.push(at);
      // An hourly run sends threshold t when the meeting is t hours away, rounded.
      const hours = Math.round((at.getTime() - now.getTime()) / HOUR_MS);
      if (thresholds.includes(hours)) due.push({ group, at, hours });
    }
    if (due.length) await this.send(due, now, timezone);
    return FellowshipReminderScheduler.nextDue(meetings, thresholds, now);
  }

  // The earliest hourly run that will send a reminder, or the next meeting's start (after which a later one is next).
  static nextDue(
    meetings: Date[],
    thresholds: number[],
    now: Date,
  ): Date | null {
    const future: number[] = [];
    for (const at of meetings)
      for (const when of [
        at.getTime() + 1000,
        ...thresholds.map((t) => at.getTime() - (t + 0.5) * HOUR_MS + 1000),
      ])
        if (when > now.getTime()) future.push(when);
    return future.length ? new Date(Math.min(...future)) : null;
  }

  private async send(
    due: DueReminder[],
    now: Date,
    timezone: string,
  ): Promise<void> {
    // One query for every due fellowship's members.
    const rows = await this.memberRepo.find({
      where: { group: { id: In(due.map((d) => d.group.id)) } },
      relations: ['member', 'group'],
    });
    const membersByGroup = new Map<string, Member[]>();
    for (const row of rows)
      membersByGroup.set(row.group.id, [
        ...(membersByGroup.get(row.group.id) ?? []),
        row.member,
      ]);

    for (const { group, at, hours } of due) {
      const sentKey = `fellowship-reminder:${group.id}:${at.getTime()}:${hours}`;
      if (await this.cacheService.get(sentKey)) continue;
      // Marked before sending: a failure afterwards skips this reminder rather than repeating it.
      await this.cacheService.set(sentKey, true, SENT_TTL_SECONDS);
      try {
        this.remind(group, at, hours, now, timezone, [
          ...(membersByGroup.get(group.id) ?? []),
          ...(group.leader ? [group.leader] : []),
        ]);
      } catch (err) {
        this.logger.warn(
          `Fellowship reminder for ${group.id} not sent: ${(err as Error).message}`,
        );
      }
    }
  }

  private remind(
    group: SmallGroup,
    at: Date,
    hours: number,
    now: Date,
    timezone: string,
    people: Member[],
  ): void {
    const recipients = [
      ...new Map(
        people
          .filter((m) => m && m.status !== MemberStatusEnum.INACTIVE)
          .map((m) => [m.id, m]),
      ).values(),
    ];
    if (!recipients.length) return;

    const day = localDate(at, timezone);
    const today = localDate(now, timezone);
    const meetingDate = this.dateService.format(at, 'EEE d MMM', timezone);
    const when =
      day === today
        ? 'today'
        : day === addDays(today, 1)
          ? 'tomorrow'
          : `on ${meetingDate}`;
    const clock = (time: string) =>
      this.dateService.format(new Date(`${day}T${time}:00Z`), 'h:mm a', 'UTC');
    const meetingTime = group.meetingEndTime
      ? `${clock(group.meetingStartTime!)}–${clock(group.meetingEndTime)}`
      : clock(group.meetingStartTime!);
    const online = group.meetingFormat === MeetingFormatEnum.ONLINE;
    const place = online
      ? 'Online'
      : (group.meetingLocation ?? group.venue?.name ?? '');
    const url = `/small-groups/${group.id}`;

    for (const member of recipients) {
      this.notificationDispatchService.notifyMember({
        category: EmailCategory.FELLOWSHIPS,
        ...(member.email && {
          email: {
            to: member.email,
            recipientMemberId: member.id,
            subject: `${group.name} meets ${when}`,
            template: 'fellowship-meeting-reminder',
            data: {
              name: member.firstname,
              groupName: group.name,
              groupId: group.id,
              when,
              meetingDate,
              meetingTime,
              place,
              notes: group.meetingNotes ?? '',
              meetingLink: online ? (group.meetingLink ?? '') : '',
            },
          },
        }),
        push: {
          memberIds: [member.id],
          key: PushNotificationKey.FELLOWSHIP_MEETING_REMINDER,
          vars: {
            group_name: group.name,
            when,
            time: meetingTime,
            place: place ? ` · ${place}` : '',
          },
          url,
          idempotencyKey: `fellowship-reminder:${group.id}:${at.getTime()}:${hours}:${member.id}`,
        },
      });
    }
  }
}
