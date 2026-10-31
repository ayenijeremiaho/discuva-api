import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { fromZonedTime } from 'date-fns-tz';
import { RotaDraft } from '../entity/rota-draft.entity';
import { RotaEntryDto } from '../dto/serving-rota.dto';
import { ChurchTimezoneService } from '../../utility/service/church-timezone.service';
import { DateService } from '../../utility/service/date.service';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';
import { AuditLogService } from '../../utility/service/audit-log.service';
import {
  RotaAccessService,
  RotaEntry,
  RotaTarget,
} from './rota-access.service';
import { ServingRotaService } from './serving-rota.service';
import { RotaCustomService } from './rota-custom.service';

const SHOWN_IN_SUMMARY = 3;

export interface RotaChange {
  label: string;
  start: Date;
  added: { memberId: string; role: string | null }[];
  removed: string[];
}

interface DraftRow {
  id: string;
  service_slot_id: string | null;
  schedule_id: string | null;
  occurrence_date: string | null;
  entries: RotaEntry[];
  updated_at: Date;
  updated_by: string | null;
  slot_name: string | null;
  slot_start: Date | null;
  schedule_name: string | null;
  schedule_start: string | null;
}

@Injectable()
export class RotaDraftService {
  constructor(
    @InjectRepository(RotaDraft)
    private readonly drafts: Repository<RotaDraft>,
    private readonly access: RotaAccessService,
    private readonly rota: ServingRotaService,
    private readonly custom: RotaCustomService,
    private readonly churchTimezone: ChurchTimezoneService,
    private readonly dateService: DateService,
    private readonly notifications: NotificationDispatchService,
    private readonly audit: AuditLogService,
  ) {}

  async list(memberId: string, departmentId: string, now = new Date()) {
    const access = await this.access.of(memberId, departmentId);
    if (!access.canPlan)
      throw new ForbiddenException('Only rota planners can see drafts.');
    const rows = await this.rows(departmentId);
    const timezone = await this.churchTimezone.get();
    return {
      canPublish: access.canPublish,
      drafts: rows
        .map((row) => ({ row, start: this.start(row, timezone) }))
        .filter(({ start }) => start > now)
        .sort((a, b) => a.start.getTime() - b.start.getTime())
        .map(({ row, start }) => ({
          id: row.id,
          name: row.slot_name ?? row.schedule_name,
          startTime: start,
          people: row.entries.length,
          updatedAt: row.updated_at,
          updatedBy: row.updated_by,
          target: row.service_slot_id
            ? { slotId: row.service_slot_id }
            : { scheduleId: row.schedule_id, date: row.occurrence_date },
        })),
    };
  }

  async save(
    memberId: string,
    departmentId: string,
    target: RotaTarget,
    entries: RotaEntryDto[],
  ) {
    const access = await this.access.of(memberId, departmentId);
    if (!access.canPlan)
      throw new ForbiddenException('Only rota planners can save a draft.');
    await this.assertTeam(departmentId, entries);
    const existing = await this.access.draft(departmentId, target);
    const base =
      existing?.entries ?? (await this.published(departmentId, target));
    const merged = this.access.merge(access.planRoles, base, entries);
    const isSlot = 'slotId' in target;
    await this.drafts.query(
      `INSERT INTO rota_drafts (department_id, service_slot_id, schedule_id, occurrence_date, entries, updated_by_id)
       VALUES ($1, $2, $3, $4::date, $5::jsonb, $6)
       ON CONFLICT ${
         isSlot
           ? '(department_id, service_slot_id) WHERE service_slot_id IS NOT NULL'
           : '(schedule_id, occurrence_date) WHERE schedule_id IS NOT NULL'
       }
       DO UPDATE SET entries = EXCLUDED.entries, updated_by_id = EXCLUDED.updated_by_id, updated_at = now()`,
      [
        departmentId,
        isSlot ? target.slotId : null,
        isSlot ? null : target.scheduleId,
        isSlot ? null : target.date,
        JSON.stringify(merged),
        memberId,
      ],
    );
    return { saved: true };
  }

  async discard(memberId: string, departmentId: string, target: RotaTarget) {
    const access = await this.access.of(memberId, departmentId);
    if (!access.canPlan)
      throw new ForbiddenException('Only rota planners can discard a draft.');
    if (access.planRoles) {
      const draft = await this.access.draft(departmentId, target);
      if (!draft) return { discarded: false };
      const published = await this.published(departmentId, target);
      await this.drafts.update(draft.id, {
        entries: this.access.merge(
          access.planRoles,
          draft.entries,
          this.access.scopeOf(access.planRoles, published),
        ),
      });
      return { discarded: true };
    }
    await this.access.clearDraft(departmentId, target);
    return { discarded: true };
  }

  // Publishes together, so each person gets one notification however many sessions it covers.
  async publish(
    memberId: string,
    departmentId: string,
    draftIds?: string[],
    now = new Date(),
  ) {
    const access = await this.access.of(memberId, departmentId);
    if (!access.canPublish)
      throw new ForbiddenException(
        'Only a department lead or planner allowed to publish can do this.',
      );
    const timezone = await this.churchTimezone.get();
    const wanted = draftIds && new Set(draftIds);
    const rows = (await this.rows(departmentId)).filter(
      (row) => !wanted || wanted.has(row.id),
    );
    if (wanted && rows.length !== wanted.size)
      throw new NotFoundException('One of those drafts no longer exists.');
    const changes: RotaChange[] = [];
    let published = 0;
    let skipped = 0;
    for (const row of rows) {
      const target = this.target(row);
      if (this.start(row, timezone) <= now) {
        await this.drafts.delete(row.id);
        skipped += 1;
        continue;
      }
      const current = await this.published(departmentId, target);
      const entries = this.access.merge(
        access.publishRoles,
        current,
        this.access.scopeOf(access.publishRoles, row.entries),
      );
      changes.push(
        'slotId' in target
          ? await this.rota.applySlot(
              memberId,
              departmentId,
              target.slotId,
              entries,
              now,
            )
          : await this.custom.applySession(
              memberId,
              departmentId,
              target.scheduleId,
              target.date,
              entries,
              now,
            ),
      );
      // Another group's changes stay in the draft until someone who can publish them does.
      if (!access.publishRoles || this.same(entries, row.entries))
        await this.drafts.delete(row.id);
      published += 1;
    }
    const notified = await this.notify(departmentId, changes, now);
    this.audit.log('ROTA_UPDATED', {
      actorId: memberId,
      targetId: departmentId,
      metadata: { published, skipped, notified },
    });
    return { published, skipped, notified };
  }

  private same(a: RotaEntry[], b: RotaEntry[]): boolean {
    const key = (entries: RotaEntry[]) =>
      entries
        .map((entry) => `${entry.memberId}:${entry.role ?? ''}`)
        .sort()
        .join('|');
    return key(a) === key(b);
  }

  private async notify(
    departmentId: string,
    changes: RotaChange[],
    now: Date,
  ): Promise<number> {
    const timezone = await this.churchTimezone.get();
    const when = (start: Date) =>
      this.dateService.format(start, 'EEE d MMM, h:mm a', timezone);
    const perPerson = new Map<string, { added: string[]; removed: string[] }>();
    const of = (id: string) => {
      const entry = perPerson.get(id) ?? { added: [], removed: [] };
      perPerson.set(id, entry);
      return entry;
    };
    for (const change of [...changes].sort(
      (a, b) => a.start.getTime() - b.start.getTime(),
    )) {
      for (const person of change.added)
        of(person.memberId).added.push(
          `${when(change.start)}${person.role ? ` · ${person.role}` : ''}`,
        );
      for (const id of change.removed) of(id).removed.push(when(change.start));
    }
    if (!perPerson.size) return 0;
    const names = (await this.drafts.query(
      `SELECT name FROM departments WHERE id = $1`,
      [departmentId],
    )) as { name: string }[];
    const shorten = (items: string[]) =>
      items.length > SHOWN_IN_SUMMARY
        ? `${items.slice(0, SHOWN_IN_SUMMARY).join(', ')} and ${items.length - SHOWN_IN_SUMMARY} more`
        : items.join(', ');
    for (const [id, person] of perPerson) {
      const parts = [
        person.added.length ? `You're serving: ${shorten(person.added)}.` : '',
        person.removed.length ? `Taken off: ${shorten(person.removed)}.` : '',
      ].filter(Boolean);
      this.notifications
        .notifyMember({
          category: EmailCategory.SERVING_ROTA,
          push: {
            memberIds: [id],
            key: PushNotificationKey.ROTA_PUBLISHED,
            vars: {
              department_name: names[0]?.name ?? 'Your department',
              summary: parts.join(' '),
            },
            url: '/rota',
            idempotencyKey: `rota-published:${departmentId}:${id}:${now.getTime()}`,
          },
        })
        .catch(() => undefined);
    }
    return perPerson.size;
  }

  private target(row: DraftRow): RotaTarget {
    return row.service_slot_id
      ? { slotId: row.service_slot_id }
      : { scheduleId: row.schedule_id!, date: row.occurrence_date! };
  }

  private start(row: DraftRow, timezone: string): Date {
    return row.slot_start
      ? new Date(row.slot_start)
      : fromZonedTime(
          `${row.occurrence_date}T${(row.schedule_start ?? '00:00:00').slice(0, 8)}`,
          timezone,
        );
  }

  private rows(departmentId: string): Promise<DraftRow[]> {
    return this.drafts.query(
      `SELECT dr.id, dr.service_slot_id, dr.schedule_id, dr.occurrence_date::text AS occurrence_date,
         dr.entries, dr.updated_at,
         NULLIF(TRIM(COALESCE(m.firstname, '') || ' ' || COALESCE(m.lastname, '')), '') AS updated_by,
         COALESCE(NULLIF(e.name, ss.name) || ' · ' || ss.name, ss.name) AS slot_name, ss.start_time AS slot_start,
         s.name AS schedule_name, s.start_time::text AS schedule_start
       FROM rota_drafts dr
       LEFT JOIN members m ON m.id = dr.updated_by_id
       LEFT JOIN service_slots ss ON ss.id = dr.service_slot_id
       LEFT JOIN events e ON e.id = ss.event_id
       LEFT JOIN rota_schedules s ON s.id = dr.schedule_id
       WHERE dr.department_id = $1`,
      [departmentId],
    ) as Promise<DraftRow[]>;
  }

  private async published(
    departmentId: string,
    target: RotaTarget,
  ): Promise<RotaEntry[]> {
    const rows = (await ('slotId' in target
      ? this.drafts.query(
          `SELECT member_id, role FROM rota_assignments WHERE department_id = $1 AND service_slot_id = $2`,
          [departmentId, target.slotId],
        )
      : this.drafts.query(
          `SELECT member_id, role FROM rota_custom_assignments WHERE schedule_id = $1 AND occurrence_date = $2::date`,
          [target.scheduleId, target.date],
        ))) as { member_id: string; role: string | null }[];
    return rows.map((row) => ({ memberId: row.member_id, role: row.role }));
  }

  private async assertTeam(departmentId: string, entries: RotaEntry[]) {
    const ids = [...new Set(entries.map((entry) => entry.memberId))];
    if (ids.length !== entries.length)
      throw new BadRequestException('Each person can only serve once here.');
    if (!ids.length) return;
    const rows = (await this.drafts.query(
      `SELECT wp.member_id FROM worker_profiles wp JOIN members m ON m.id = wp.member_id
       WHERE wp.status = 'ACTIVE' AND m.status = 'ACTIVE' AND wp.member_id = ANY($2)
         AND (wp.department_id = $1 OR wp.secondary_department_id = $1)`,
      [departmentId, ids],
    )) as { member_id: string }[];
    if (rows.length !== ids.length)
      throw new BadRequestException(
        'Only active workers in this department can be on its rota.',
      );
  }
}
