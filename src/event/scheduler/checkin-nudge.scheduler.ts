import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { ServiceSlot } from '../entity/service-slot.entity';
import { Member } from '../../member/entity/member.entity';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { scopeToAudience } from '../utility/event-audience';
import { SchedulerGateService } from '../../tenant/scheduler-gate/scheduler-gate.service';
import { CacheService } from '../../utility/service/cache.service';
import { DateService } from '../../utility/service/date.service';
import { ChurchTimezoneService } from '../../utility/service/church-timezone.service';
import { ReminderSettingsService } from '../../reminder-settings/service/reminder-settings.service';
import { ReminderSettingKey } from '../../reminder-settings/enum/reminder-setting-key.enum';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';

const MINUTE_MS = 60_000;
// A tick missed by up to this much still sends; after that the moment has passed.
const SEND_WINDOW_MS = 15 * MINUTE_MS;
// Services that started this long ago can still have someone to nudge (a long late allowance).
const LOOKBACK_MS = 12 * 60 * MINUTE_MS;
const SENT_TTL_SECONDS = 2 * 24 * 3600;

type Kind = 'worker' | 'member';

interface DueNudge {
  slot: ServiceSlot;
  kind: Kind;
  minutes: number;
  // When a worker would be marked late, or when the service starts for members.
  deadline: Date;
}

// Nudges people who haven't checked in yet, minutes before it matters: workers before they'd be marked late,
// members before the service starts (members are never late). Minutes come from Reminder Settings (default 15).
@Injectable()
export class CheckinNudgeScheduler {
  private static readonly LOCK_KEY = 'lock:checkin-nudges';
  private readonly logger = new Logger(CheckinNudgeScheduler.name);

  constructor(
    @InjectRepository(ServiceSlot)
    private readonly slotRepo: Repository<ServiceSlot>,
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    private readonly gate: SchedulerGateService,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly cacheService: CacheService,
    private readonly dateService: DateService,
    private readonly churchTimezone: ChurchTimezoneService,
    private readonly reminderSettings: ReminderSettingsService,
    private readonly notifications: NotificationDispatchService,
  ) {}

  @Cron('*/5 * * * *')
  async dispatchCheckinNudges(): Promise<void> {
    if (
      !(await this.cacheService.acquireLock(
        CheckinNudgeScheduler.LOCK_KEY,
        240,
      ))
    )
      return;
    try {
      await this.gate.forEachDueTenant(
        'checkin-nudges',
        this.txHost,
        this.logger,
        () => this.runNudges(),
      );
    } finally {
      this.cacheService.releaseLock(CheckinNudgeScheduler.LOCK_KEY);
    }
  }

  static lateAt(slot: ServiceSlot): Date {
    const offset =
      slot.workerLateOverride ?? slot.config?.workerLateOffsetSeconds ?? 0;
    return new Date(slot.startTime.getTime() + offset * 1000);
  }

  // Returns when this church next needs a run (null when nudges are off or nothing is scheduled).
  async runNudges(now = new Date()): Promise<Date | null> {
    const { enabled, thresholds } = await this.reminderSettings.getConfig(
      ReminderSettingKey.CHECKIN_NUDGE,
    );
    const leads = [...new Set(thresholds)].filter((m) => m > 0);
    if (!enabled || !leads.length) return null;
    const furthest = Math.max(...leads) * MINUTE_MS;

    const slots = await this.slotRepo
      .createQueryBuilder('slot')
      .innerJoinAndSelect('slot.event', 'event')
      .leftJoinAndSelect('slot.config', 'config')
      .where('slot.endTime > :now', { now })
      .andWhere('slot.startTime >= :from', {
        from: new Date(now.getTime() - LOOKBACK_MS),
      })
      .andWhere('slot.startTime <= :until', {
        until: new Date(now.getTime() + furthest + SEND_WINDOW_MS),
      })
      .orderBy('slot.startTime', 'ASC')
      .getMany();

    const due: DueNudge[] = [];
    const upcoming: number[] = [];
    for (const slot of slots) {
      const deadlines: [Kind, Date][] = [
        ['worker', CheckinNudgeScheduler.lateAt(slot)],
        ['member', slot.startTime],
      ];
      for (const [kind, deadline] of deadlines)
        for (const minutes of leads) {
          const at = deadline.getTime() - minutes * MINUTE_MS;
          if (at > now.getTime()) upcoming.push(at);
          else if (
            now.getTime() - at < SEND_WINDOW_MS &&
            deadline.getTime() > now.getTime()
          )
            due.push({ slot, kind, minutes, deadline });
        }
    }
    if (due.length) {
      const timezone = await this.churchTimezone.get();
      for (const nudge of due) await this.nudge(nudge, timezone);
    }

    if (upcoming.length) return new Date(Math.min(...upcoming));
    const next = await this.slotRepo
      .createQueryBuilder('slot')
      .select(['slot.id', 'slot.startTime'])
      .where('slot.startTime > :until', {
        until: new Date(now.getTime() + furthest + SEND_WINDOW_MS),
      })
      .orderBy('slot.startTime', 'ASC')
      .getOne();
    return next ? new Date(next.startTime.getTime() - furthest) : null;
  }

  private async nudge(
    { slot, kind, minutes, deadline }: DueNudge,
    timezone: string,
  ): Promise<void> {
    const sentKey = `checkin-nudge:${slot.id}:${kind}:${minutes}`;
    if (await this.cacheService.get(sentKey)) return;
    // Marked before sending: a failure afterwards skips this nudge rather than repeating it.
    await this.cacheService.set(sentKey, true, SENT_TTL_SECONDS);
    try {
      // People the service is for, of this kind, with nothing recorded for the event yet.
      const qb = this.memberRepo
        .createQueryBuilder('m')
        .select(['m.id'])
        .where('m.status = :status', { status: MemberStatusEnum.ACTIVE })
        .andWhere(
          kind === 'worker' ? 'm.role = :worker' : 'm.role != :worker',
          { worker: MemberRoleEnum.WORKER },
        )
        .andWhere(
          'NOT EXISTS (SELECT 1 FROM attendances a WHERE a.member_id = m.id AND a.event_id = :eventId)',
          { eventId: slot.event.id },
        );
      scopeToAudience(qb, 'm', slot.event ?? {});
      scopeToAudience(qb, 'm', slot, 'slotAudience');
      const memberIds = (await qb.getMany()).map((m) => m.id);
      if (!memberIds.length) return;

      const time = this.dateService.format(deadline, 'h:mm a', timezone);
      const serviceName =
        slot.event?.name && slot.event.name !== slot.name
          ? `${slot.event.name} · ${slot.name}`
          : slot.name;
      await this.notifications.notifyMember({
        category: EmailCategory.EVENT_REMINDER,
        push: {
          memberIds,
          key:
            kind === 'worker'
              ? PushNotificationKey.CHECKIN_NUDGE_WORKER
              : PushNotificationKey.CHECKIN_NUDGE_MEMBER,
          vars:
            kind === 'worker'
              ? { service_name: serviceName, late_time: time }
              : { service_name: serviceName, start_time: time },
          url: `/events/${slot.event.id}`,
          idempotencyKey: sentKey,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Check-in nudge for slot ${slot.id} not sent: ${(err as Error).message}`,
      );
    }
  }
}
