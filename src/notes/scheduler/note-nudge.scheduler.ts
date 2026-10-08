import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { toZonedTime } from 'date-fns-tz';
import {
  ActiveTenant,
  SchedulerGateService,
} from '../../tenant/scheduler-gate/scheduler-gate.service';
import { runInTenantContext } from '../../tenant/utility/run-in-tenant-context';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { CacheService } from '../../utility/service/cache.service';
import { CHURCH_TIMEZONE } from '../../utility/constants/app.constants';
import { ChurchSettingsService } from '../../church-settings/service/church-settings.service';
import { PlanFeatureResolverService } from '../../billing/service/plan-feature-resolver.service';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';

const LOCK = 'lock:note-nudges';
export const EVENING_NUDGE_HOUR = 19;
export const COMMITMENT_NUDGE_HOUR = 8;
const MONDAY = 1;
const COMMITMENT_PUSH_MAX = 90;

// Reminders that only fire outside services: the evening after one, and Monday morning.
@Injectable()
export class NoteNudgeScheduler {
  private readonly logger = new Logger(NoteNudgeScheduler.name);

  constructor(
    private readonly gate: SchedulerGateService,
    private readonly cacheService: CacheService,
    private readonly config: ConfigService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly churchSettings: ChurchSettingsService,
    private readonly planFeatures: PlanFeatureResolverService,
    private readonly push: PushNotificationService,
  ) {}

  @Cron('5 * * * *')
  async run(now = new Date()): Promise<void> {
    const acquired = await this.cacheService.acquireLock(LOCK, 900);
    if (!acquired) return;
    try {
      // Only churches whose local hour matches open a database transaction.
      for (const tenant of await this.gate.activeTenants()) {
        const local = toZonedTime(now, this.timezoneOf(tenant));
        const evening = local.getHours() === EVENING_NUDGE_HOUR;
        const monday =
          local.getDay() === MONDAY &&
          local.getHours() === COMMITMENT_NUDGE_HOUR;
        if (!evening && !monday) continue;
        try {
          await runInTenantContext(
            this.cls,
            this.txHost,
            { tenantId: tenant.id, schemaName: tenant.schemaName },
            async () => {
              if (!(await this.notesAvailable(tenant.id))) return;
              if (evening) await this.eveningNudges();
              if (monday) await this.commitmentReminders();
            },
          );
        } catch (err) {
          this.logger.warn(
            `Note nudges failed for "${tenant.subdomain}": ${(err as Error)?.message ?? err}`,
          );
        }
      }
    } finally {
      this.cacheService.releaseLock(LOCK);
    }
  }

  // Members who attended a service that ended today and haven't written anything for it.
  async eveningNudges(): Promise<void> {
    const rows = (await this.txHost.tx.query(
      `SELECT a.member_id AS "memberId", e.id AS "eventId", e.name AS "eventName",
              COALESCE(a.service_slot_id,
                (SELECT ss.id FROM service_slots ss WHERE ss.event_id = e.id ORDER BY ss.start_time LIMIT 1)) AS "slotId"
       FROM attendances a
       JOIN events e ON e.id = a.event_id
       JOIN members m ON m.id = a.member_id
       WHERE a.status IN ('PRESENT', 'LATE', 'ATTENDED_ONLINE')
         AND e.end_time <= now()
         AND e.end_time >= now() - interval '14 hours'
         AND m.note_nudges
         AND NOT EXISTS (
           SELECT 1 FROM notes n WHERE n.member_id = a.member_id AND n.event_id = e.id AND n.word_count > 0
         )`,
    )) as {
      memberId: string;
      eventId: string;
      eventName: string;
      slotId: string | null;
    }[];

    const groups = new Map<
      string,
      {
        eventId: string;
        eventName: string;
        slotId: string | null;
        memberIds: string[];
      }
    >();
    for (const row of rows) {
      const key = `${row.eventId}:${row.slotId ?? ''}`;
      const group = groups.get(key) ?? {
        eventId: row.eventId,
        eventName: row.eventName,
        slotId: row.slotId,
        memberIds: [],
      };
      group.memberIds.push(row.memberId);
      groups.set(key, group);
    }

    for (const group of groups.values()) {
      await this.push.dispatchToMemberIds(group.memberIds, {
        key: PushNotificationKey.NOTE_EVENING_NUDGE,
        vars: { service_name: group.eventName },
        url: group.slotId ? `/notes/new?slot=${group.slotId}` : '/notes/new',
        idempotencyKey: `note-evening:${group.eventId}`,
      });
    }
  }

  // Each member's most recent "One thing I'll do this week" from the past week.
  async commitmentReminders(): Promise<void> {
    const rows = (await this.txHost.tx.query(
      `SELECT DISTINCT ON (n.member_id) n.member_id AS "memberId", n.id, n.commitment
       FROM notes n
       JOIN members m ON m.id = n.member_id
       WHERE n.commitment IS NOT NULL
         AND n.created_at >= now() - interval '8 days'
         AND m.note_nudges
       ORDER BY n.member_id, n.created_at DESC`,
    )) as { memberId: string; id: string; commitment: string }[];

    for (const row of rows) {
      const commitment =
        row.commitment.length > COMMITMENT_PUSH_MAX
          ? `${row.commitment.slice(0, COMMITMENT_PUSH_MAX - 1).trimEnd()}…`
          : row.commitment;
      await this.push.dispatchToMemberIds([row.memberId], {
        key: PushNotificationKey.NOTE_COMMITMENT_REMINDER,
        vars: { commitment },
        url: `/notes/${row.id}`,
        idempotencyKey: `note-commitment:${row.id}`,
      });
    }
  }

  private async notesAvailable(tenantId: string): Promise<boolean> {
    if (!(await this.churchSettings.isEnabled('notes'))) return false;
    const { features, overrides } = await this.planFeatures.resolve(tenantId);
    if (overrides.notes !== undefined) return overrides.notes;
    return features.includes('notes');
  }

  private timezoneOf(tenant: ActiveTenant): string {
    return (
      tenant.timezone || this.config.get<string>('TIMEZONE') || CHURCH_TIMEZONE
    );
  }
}
