import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { TeamSpace, TeamSpaceKindEnum } from '../entity/team-space.entity';
import { TeamSpaceAccessService } from '../service/team-space-access.service';
import { SchedulerGateService } from '../../tenant/scheduler-gate/scheduler-gate.service';
import { CacheService } from '../../utility/service/cache.service';
import { ChurchSettingsService } from '../../church-settings/service/church-settings.service';
import { ReminderSettingsService } from '../../reminder-settings/service/reminder-settings.service';
import { ReminderSettingKey } from '../../reminder-settings/enum/reminder-setting-key.enum';
import { ChurchTimezoneService } from '../../utility/service/church-timezone.service';
import { DateService } from '../../utility/service/date.service';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';

const HOUR_MS = 3600 * 1000;
// A tick missed by up to this much still sends; after that the moment has passed.
const SEND_WINDOW_MS = 15 * 60 * 1000;

interface MeetingRow {
  post_id: string;
  title: string;
  starts_at: Date;
  location: string | null;
  space_id: string;
  kind: TeamSpaceKindEnum;
  ref_id: string;
  space_name: string;
}

// Reminds a team before its meetings, skipping anyone who said they can't come.
@Injectable()
export class TeamMeetingReminderScheduler {
  private static readonly LOCK_KEY = 'lock:team-meeting-reminders';
  private readonly logger = new Logger(TeamMeetingReminderScheduler.name);

  constructor(
    @InjectRepository(TeamSpace)
    private readonly spaceRepo: Repository<TeamSpace>,
    private readonly access: TeamSpaceAccessService,
    private readonly gate: SchedulerGateService,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly cacheService: CacheService,
    private readonly churchSettings: ChurchSettingsService,
    private readonly reminderSettings: ReminderSettingsService,
    private readonly churchTimezone: ChurchTimezoneService,
    private readonly dateService: DateService,
    private readonly notifications: NotificationDispatchService,
  ) {}

  @Cron('*/15 * * * *')
  async run(): Promise<void> {
    if (
      !(await this.cacheService.acquireLock(
        TeamMeetingReminderScheduler.LOCK_KEY,
        600,
      ))
    )
      return;
    try {
      await this.gate.forEachDueTenant(
        'team-meeting-reminders',
        this.txHost,
        this.logger,
        () => this.runReminders(),
      );
    } finally {
      this.cacheService.releaseLock(TeamMeetingReminderScheduler.LOCK_KEY);
    }
  }

  async runReminders(now = new Date()): Promise<Date | null> {
    if (!(await this.churchSettings.isEnabled('team_spaces'))) return null;
    const { enabled, thresholds } = await this.reminderSettings.getConfig(
      ReminderSettingKey.TEAM_MEETING,
    );
    const hours = [...new Set(thresholds)].filter((h) => h > 0);
    if (!enabled || !hours.length) return null;
    const furthest = Math.max(...hours) * HOUR_MS;

    const meetings = (await this.spaceRepo.query(
      `SELECT m.post_id, m.title, m.starts_at, m.location, s.id AS space_id, s.kind, s.ref_id,
         COALESCE(d.name, g.name) AS space_name
       FROM team_meetings m
       JOIN team_posts p ON p.id = m.post_id AND p.removed_at IS NULL
       JOIN team_spaces s ON s.id = m.space_id
       LEFT JOIN departments d ON s.kind = 'DEPARTMENT' AND d.id = s.ref_id
       LEFT JOIN small_groups g ON s.kind = 'FELLOWSHIP' AND g.id = s.ref_id
       WHERE m.cancelled_at IS NULL AND m.starts_at > $1 AND m.starts_at <= $2
       ORDER BY m.starts_at`,
      [now, new Date(now.getTime() + furthest + SEND_WINDOW_MS)],
    )) as MeetingRow[];

    const upcoming: number[] = [];
    let timezone: string | null = null;
    for (const meeting of meetings) {
      const start = new Date(meeting.starts_at).getTime();
      for (const h of hours) {
        const at = start - h * HOUR_MS;
        if (at > now.getTime()) {
          upcoming.push(at);
          continue;
        }
        if (now.getTime() - at >= SEND_WINDOW_MS) continue;
        const sentKey = `team-meeting-reminder:${meeting.post_id}:${h}`;
        if (await this.cacheService.get(sentKey)) continue;
        this.cacheService.set(sentKey, true, 3 * 24 * 3600);
        timezone ??= await this.churchTimezone.get();
        await this.remind(meeting, h, timezone);
      }
    }
    if (upcoming.length) return new Date(Math.min(...upcoming));
    const next = (await this.spaceRepo.query(
      `SELECT starts_at FROM team_meetings WHERE cancelled_at IS NULL AND starts_at > $1 ORDER BY starts_at LIMIT 1`,
      [new Date(now.getTime() + furthest + SEND_WINDOW_MS)],
    )) as { starts_at: Date }[];
    return next[0]
      ? new Date(new Date(next[0].starts_at).getTime() - furthest)
      : null;
  }

  private async remind(
    meeting: MeetingRow,
    hoursBefore: number,
    timezone: string,
  ) {
    const [roster, declined] = await Promise.all([
      this.access.memberIds({ kind: meeting.kind, refId: meeting.ref_id }),
      this.spaceRepo.query(
        `SELECT member_id FROM team_meeting_rsvps WHERE meeting_id = $1 AND response = 'NOT_GOING'`,
        [meeting.post_id],
      ) as Promise<{ member_id: string }[]>,
    ]);
    const skip = new Set(declined.map((r) => r.member_id));
    const memberIds = roster.filter((id) => !skip.has(id));
    if (!memberIds.length) return;
    const time = this.dateService.format(
      new Date(meeting.starts_at),
      'h:mm a',
      timezone,
    );
    const when =
      hoursBefore < 24
        ? `at ${time}`
        : `on ${this.dateService.format(new Date(meeting.starts_at), "EEE d MMM 'at' h:mm a", timezone)}`;
    await this.notifications
      .notifyMember({
        category: EmailCategory.TEAM_SPACES,
        push: {
          memberIds,
          key: PushNotificationKey.TEAM_SPACE_MEETING_REMINDER,
          vars: {
            title: meeting.title,
            when,
            space_name: meeting.space_name ?? 'Your team',
            place: meeting.location ? ` · ${meeting.location}` : '',
          },
          url: `/team-spaces/meeting/${meeting.post_id}`,
          idempotencyKey: `team-meeting-reminder:${meeting.post_id}:${hoursBefore}`,
        },
      })
      .catch((err: Error) =>
        this.logger.warn(
          `Meeting reminder ${meeting.post_id} not sent: ${err.message}`,
        ),
      );
  }
}
