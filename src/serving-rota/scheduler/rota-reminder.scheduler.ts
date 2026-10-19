import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { RotaAssignment } from '../entity/rota-assignment.entity';
import { serviceName } from '../service/serving-rota.service';
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

interface DutyRow {
  slot_id: string;
  name: string;
  event_name: string;
  start_time: Date;
  member_id: string;
  role: string | null;
  department_name: string;
}

// Reminds everyone on the rota before they serve.
@Injectable()
export class RotaReminderScheduler {
  private static readonly LOCK_KEY = 'lock:rota-reminders';
  private readonly logger = new Logger(RotaReminderScheduler.name);

  constructor(
    @InjectRepository(RotaAssignment)
    private readonly assignmentRepo: Repository<RotaAssignment>,
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
        RotaReminderScheduler.LOCK_KEY,
        600,
      ))
    )
      return;
    try {
      await this.gate.forEachDueTenant(
        'rota-reminders',
        this.txHost,
        this.logger,
        () => this.runReminders(),
      );
    } finally {
      this.cacheService.releaseLock(RotaReminderScheduler.LOCK_KEY);
    }
  }

  async runReminders(now = new Date()): Promise<Date | null> {
    if (!(await this.churchSettings.isEnabled('serving_rota'))) return null;
    const { enabled, thresholds } = await this.reminderSettings.getConfig(
      ReminderSettingKey.ROTA_DUTY,
    );
    const hours = [...new Set(thresholds)].filter((h) => h > 0);
    if (!enabled || !hours.length) return null;
    const furthest = Math.max(...hours) * HOUR_MS;

    // Services with anyone on the rota, in reach of the furthest reminder; the slot start-time index finds them.
    const duties = (await this.assignmentRepo.query(
      `SELECT ss.id AS slot_id, ss.name, e.name AS event_name, ss.start_time, a.member_id, a.role, d.name AS department_name
       FROM service_slots ss
       JOIN rota_assignments a ON a.service_slot_id = ss.id
       JOIN events e ON e.id = ss.event_id
       JOIN departments d ON d.id = a.department_id
       JOIN members m ON m.id = a.member_id AND m.status = 'ACTIVE'
       WHERE ss.start_time > $1 AND ss.start_time <= $2`,
      [now, new Date(now.getTime() + furthest + SEND_WINDOW_MS)],
    )) as DutyRow[];

    const bySlot = new Map<string, DutyRow[]>();
    for (const d of duties)
      bySlot.set(d.slot_id, [...(bySlot.get(d.slot_id) ?? []), d]);
    const upcoming: number[] = [];
    let timezone: string | null = null;
    for (const [slotId, rows] of bySlot) {
      const start = new Date(rows[0].start_time).getTime();
      for (const h of hours) {
        const at = start - h * HOUR_MS;
        if (at > now.getTime()) {
          upcoming.push(at);
          continue;
        }
        if (now.getTime() - at >= SEND_WINDOW_MS) continue;
        const sentKey = `rota-reminder:${slotId}:${h}`;
        if (await this.cacheService.get(sentKey)) continue;
        this.cacheService.set(sentKey, true, 3 * 24 * 3600);
        timezone ??= await this.churchTimezone.get();
        this.remind(rows, h, timezone);
      }
    }
    if (upcoming.length) return new Date(Math.min(...upcoming));
    const next = (await this.assignmentRepo.query(
      `SELECT ss.start_time FROM service_slots ss
       WHERE ss.start_time > $1 AND EXISTS (SELECT 1 FROM rota_assignments a WHERE a.service_slot_id = ss.id)
       ORDER BY ss.start_time LIMIT 1`,
      [new Date(now.getTime() + furthest + SEND_WINDOW_MS)],
    )) as { start_time: Date }[];
    return next[0]
      ? new Date(new Date(next[0].start_time).getTime() - furthest)
      : null;
  }

  // One send per department and role at this service, so each message names the person's own role.
  private remind(rows: DutyRow[], hoursBefore: number, timezone: string) {
    const start = new Date(rows[0].start_time);
    const time = this.dateService.format(start, 'h:mm a', timezone);
    const when =
      hoursBefore < 24
        ? `today at ${time}`
        : `${this.dateService.format(start, 'EEE', timezone)} at ${time}`;
    const groups = new Map<string, DutyRow[]>();
    for (const r of rows) {
      const key = `${r.department_name}|${r.role ?? ''}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    for (const [key, group] of groups)
      this.notifications
        .notifyMember({
          category: EmailCategory.SERVING_ROTA,
          push: {
            memberIds: group.map((g) => g.member_id),
            key: PushNotificationKey.ROTA_REMINDER,
            vars: {
              when:
                hoursBefore >= 24 && hoursBefore < 48
                  ? `tomorrow at ${time}`
                  : when,
              service_name: serviceName(group[0]),
              role: group[0].role ? ` · ${group[0].role}` : '',
              department_name: group[0].department_name,
            },
            url: '/rota',
            idempotencyKey: `rota-reminder:${rows[0].slot_id}:${hoursBefore}:${key}`,
          },
        })
        .catch((err: Error) =>
          this.logger.warn(`Rota reminder not sent: ${err.message}`),
        );
  }
}
