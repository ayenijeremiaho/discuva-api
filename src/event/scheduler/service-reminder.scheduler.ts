import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { ServiceSlot } from '../entity/service-slot.entity';
import { Member } from '../../member/entity/member.entity';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { scopeToAudience } from '../utility/event-audience';
import { SchedulerGateService } from '../../tenant/scheduler-gate/scheduler-gate.service';
import { CacheService } from '../../utility/service/cache.service';
import { ReminderSettingsService } from '../../reminder-settings/service/reminder-settings.service';
import { ReminderSettingKey } from '../../reminder-settings/enum/reminder-setting-key.enum';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';

const HOUR_MS = 3_600_000;
// A tick missed by up to this much still sends; later than that the moment has passed.
const SEND_WINDOW_MS = HOUR_MS;
const SENT_TTL_SECONDS = 3 * 24 * 3600;

interface DueReminder {
  slot: ServiceSlot;
  hours: number;
}

// Reminds the people a service is for, before every service, at the hours set in Reminder Settings (default the day
// before and 2 hours before), so a repeating service doesn't depend on someone adding reminders to each date. A
// service an admin gave its own reminders keeps only those.
@Injectable()
export class ServiceReminderScheduler {
  private static readonly LOCK_KEY = 'lock:service-reminders';
  private readonly logger = new Logger(ServiceReminderScheduler.name);

  constructor(
    @InjectRepository(ServiceSlot)
    private readonly slotRepo: Repository<ServiceSlot>,
    @InjectRepository(Member)
    private readonly memberRepo: Repository<Member>,
    private readonly gate: SchedulerGateService,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly cacheService: CacheService,
    private readonly reminderSettings: ReminderSettingsService,
    private readonly notifications: NotificationDispatchService,
  ) {}

  @Cron('*/15 * * * *')
  async dispatchServiceReminders(): Promise<void> {
    if (
      !(await this.cacheService.acquireLock(
        ServiceReminderScheduler.LOCK_KEY,
        600,
      ))
    )
      return;
    try {
      await this.gate.forEachDueTenant(
        'service-reminders',
        this.txHost,
        this.logger,
        () => this.runReminders(),
      );
    } finally {
      this.cacheService.releaseLock(ServiceReminderScheduler.LOCK_KEY);
    }
  }

  // Returns when this church next needs a run (null when reminders are off or nothing is scheduled).
  async runReminders(now = new Date()): Promise<Date | null> {
    const { enabled, thresholds } = await this.reminderSettings.getConfig(
      ReminderSettingKey.SERVICE_REMINDER,
    );
    const hours = [...new Set(thresholds)].filter((h) => h > 0);
    if (!enabled || !hours.length) return null;
    const furthest = Math.max(...hours) * HOUR_MS;

    // Services within reach of a reminder, leaving out any with their own enabled reminders.
    const slots = await this.slotRepo
      .createQueryBuilder('slot')
      .innerJoinAndSelect('slot.event', 'event')
      .leftJoin('slot.config', 'config')
      .where('slot.startTime > :now', { now })
      .andWhere('(config.id IS NULL OR config.sendServiceReminders = true)')
      .andWhere('slot.startTime <= :until', {
        until: new Date(now.getTime() + furthest + SEND_WINDOW_MS),
      })
      .andWhere(
        'NOT EXISTS (SELECT 1 FROM event_reminders r WHERE r.service_slot_id = slot.id AND r.enabled = true)',
      )
      .orderBy('slot.startTime', 'ASC')
      .getMany();

    const due: DueReminder[] = [];
    const upcoming: number[] = [];
    for (const slot of slots) {
      for (const h of hours) {
        const at = slot.startTime.getTime() - h * HOUR_MS;
        if (at > now.getTime()) upcoming.push(at);
        else if (now.getTime() - at < SEND_WINDOW_MS)
          due.push({ slot, hours: h });
      }
    }
    for (const reminder of due) await this.remind(reminder);

    if (upcoming.length) return new Date(Math.min(...upcoming));
    // Nothing in reach yet: wake when the next service comes within reach of the earliest reminder.
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

  private async remind({ slot, hours }: DueReminder): Promise<void> {
    const sentKey = `service-reminder:${slot.id}:${hours}`;
    if (await this.cacheService.get(sentKey)) return;
    // Marked before sending: a failure afterwards skips this reminder rather than repeating it.
    await this.cacheService.set(sentKey, true, SENT_TTL_SECONDS);
    try {
      const qb = this.memberRepo
        .createQueryBuilder('m')
        .select(['m.id'])
        .where('m.status = :status', { status: MemberStatusEnum.ACTIVE });
      scopeToAudience(qb, 'm', slot.event ?? {});
      scopeToAudience(qb, 'm', slot, 'slotAudience');
      const memberIds = (await qb.getMany()).map((m) => m.id);
      if (!memberIds.length) return;
      const multiple = slot.event?.name && slot.event.name !== slot.name;
      // Push only: an email to every member before every service would be noise, and uses the church's email allowance.
      await this.notifications.notifyMember({
        category: EmailCategory.EVENT_REMINDER,
        push: {
          memberIds,
          key: PushNotificationKey.SERVICE_REMINDER,
          vars: {
            service_name: multiple
              ? `${slot.event.name} · ${slot.name}`
              : slot.name,
            time_until:
              hours % 24 === 0
                ? `${hours / 24} day${hours === 24 ? '' : 's'}`
                : `${hours} hour${hours === 1 ? '' : 's'}`,
          },
          url: slot.event ? `/events/${slot.event.id}` : '/events',
          idempotencyKey: `service-reminder:${slot.id}:${hours}`,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Service reminder for slot ${slot.id} not sent: ${(err as Error).message}`,
      );
    }
  }
}
