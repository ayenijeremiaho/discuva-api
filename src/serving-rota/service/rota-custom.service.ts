import { RotaAccessService } from './rota-access.service';
import type { RotaChange } from './rota-draft.service';
import { DateService } from '../../utility/service/date.service';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Repository } from 'typeorm';
import { fromZonedTime } from 'date-fns-tz';
import { RotaCustomAssignment } from '../entity/rota-custom-assignment.entity';
import { RotaEntryDto } from '../dto/serving-rota.dto';
import { RotaScheduleType } from '../enum/rota-allocation-mode.enum';
import { ChurchTimezoneService } from '../../utility/service/church-timezone.service';
import { addDays, localDate } from '../../event/types/slot-blueprint';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { SchedulerGateService } from '../../tenant/scheduler-gate/scheduler-gate.service';

const PLAN_DAYS = 56;
const NAME_SQL = (alias: string) =>
  `NULLIF(TRIM(COALESCE(${alias}.firstname, '') || ' ' || COALESCE(${alias}.lastname, '')), '')`;

interface ScheduleRow {
  id: string;
  name: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
}

@Injectable()
export class RotaCustomService {
  constructor(
    @InjectRepository(RotaCustomAssignment)
    private readonly assignments: Repository<RotaCustomAssignment>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly churchTimezone: ChurchTimezoneService,
    private readonly notifications: NotificationDispatchService,
    private readonly audit: AuditLogService,
    private readonly gate: SchedulerGateService,
    private readonly planAccess: RotaAccessService,
    private readonly dateService: DateService,
  ) {}

  async list(memberId: string, departmentId: string, now = new Date()) {
    const access = await this.access(memberId, departmentId);
    const drafts = access.canPlan
      ? await this.planAccess.draftKeys(departmentId)
      : new Set<string>();
    const timezone = await this.churchTimezone.get();
    const from = localDate(now, timezone);
    const until = addDays(from, PLAN_DAYS);
    const [schedules, counts] = await Promise.all([
      this.assignments.query(
        `SELECT id, name, day_of_week, start_time::text, end_time::text
         FROM rota_schedules
         WHERE department_id = $1 AND schedule_type = 'CUSTOM' AND active = true
         ORDER BY position, name`,
        [departmentId],
      ) as Promise<ScheduleRow[]>,
      this.assignments.query(
        `SELECT a.schedule_id, a.occurrence_date::text AS occurrence_date, count(*)::int AS assigned,
           bool_or(a.member_id = $2) AS mine,
           count(c.id)::int AS open_cover
         FROM rota_custom_assignments a JOIN rota_schedules s ON s.id = a.schedule_id
         LEFT JOIN rota_cover_requests c ON c.custom_assignment_id = a.id AND c.status = 'OPEN'
         WHERE s.department_id = $1 AND a.occurrence_date BETWEEN $3::date AND $4::date
         GROUP BY a.schedule_id, a.occurrence_date`,
        [departmentId, memberId, from, until],
      ) as Promise<
        {
          schedule_id: string;
          occurrence_date: string;
          assigned: number;
          mine: boolean;
          open_cover: number;
        }[]
      >,
    ]);
    const countMap = new Map(
      counts.map((row) => [`${row.schedule_id}:${row.occurrence_date}`, row]),
    );
    const sessions = [];
    for (const schedule of schedules) {
      for (let offset = 0; offset <= PLAN_DAYS; offset++) {
        const date = addDays(from, offset);
        if (this.weekday(date) !== schedule.day_of_week) continue;
        const start = fromZonedTime(
          `${date}T${schedule.start_time.slice(0, 8)}`,
          timezone,
        );
        if (start <= now) continue;
        const end = fromZonedTime(
          `${date}T${schedule.end_time.slice(0, 8)}`,
          timezone,
        );
        const count = countMap.get(`${schedule.id}:${date}`);
        sessions.push({
          scheduleId: schedule.id,
          date,
          name: schedule.name,
          startTime: start,
          endTime: end,
          assigned: count?.assigned ?? 0,
          mine: !!count?.mine,
          openCover: count?.open_cover ?? 0,
          hasDraft: drafts.has(`${schedule.id}:${date}`),
        });
      }
    }
    sessions.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    return { ...access, sessions };
  }

  async detail(
    memberId: string,
    departmentId: string,
    scheduleId: string,
    date: string,
  ) {
    const access = await this.access(memberId, departmentId);
    const schedule = await this.schedule(scheduleId, departmentId);
    const { start, end } = await this.occurrence(schedule, date);
    const [assigned, team, previous] = await Promise.all([
      this.assignments.query(
        `SELECT a.id, a.member_id, a.role, ${NAME_SQL('m')} AS name, m.photo_url,
           EXISTS (SELECT 1 FROM rota_unavailability u
                   WHERE u.member_id = a.member_id AND u.date = a.occurrence_date) AS unavailable,
           c.id AS cover_id, c.reason AS cover_reason, c.target_member_id AS cover_target
         FROM rota_custom_assignments a JOIN members m ON m.id = a.member_id
         LEFT JOIN rota_cover_requests c ON c.custom_assignment_id = a.id AND c.status = 'OPEN'
         WHERE a.schedule_id = $1 AND a.occurrence_date = $2::date
         ORDER BY a.role, name`,
        [scheduleId, date],
      ) as Promise<
        {
          id: string;
          member_id: string;
          role: string;
          name: string | null;
          photo_url: string | null;
          unavailable: boolean;
          cover_id: string | null;
          cover_reason: string | null;
          cover_target: string | null;
        }[]
      >,
      this.assignments.query(
        `SELECT DISTINCT m.id, ${NAME_SQL('m')} AS name, m.photo_url,
           (SELECT rl.status FROM request_leave rl JOIN worker_profiles lw ON lw.id = rl.worker_profile_id
            WHERE lw.member_id = m.id AND rl.status IN ('APPROVED', 'PENDING')
              AND $2::date BETWEEN rl.date_from AND rl.date_to
            ORDER BY (rl.status = 'APPROVED') DESC LIMIT 1) AS leave,
           EXISTS (SELECT 1 FROM rota_unavailability u WHERE u.member_id = m.id AND u.date = $2::date) AS unavailable,
           (SELECT string_agg(DISTINCT d.name, ', ' ORDER BY d.name)
            FROM rota_assignments other JOIN service_slots ss ON ss.id = other.service_slot_id
            JOIN departments d ON d.id = other.department_id
            WHERE other.member_id = m.id AND ss.start_time < $4 AND ss.end_time > $3) AS elsewhere
         FROM worker_profiles wp JOIN members m ON m.id = wp.member_id
         WHERE wp.status = 'ACTIVE' AND m.status = 'ACTIVE'
           AND (wp.department_id = $1 OR wp.secondary_department_id = $1)
         ORDER BY name`,
        [departmentId, date, start, end],
      ) as Promise<
        {
          id: string;
          name: string | null;
          photo_url: string | null;
          leave: 'APPROVED' | 'PENDING' | null;
          unavailable: boolean;
          elsewhere: string | null;
        }[]
      >,
      access.canPlan
        ? (this.assignments.query(
            `SELECT member_id, role FROM rota_custom_assignments
             WHERE schedule_id = $1 AND occurrence_date = (
               SELECT max(occurrence_date) FROM rota_custom_assignments
               WHERE schedule_id = $1 AND occurrence_date < $2::date)`,
            [scheduleId, date],
          ) as Promise<{ member_id: string; role: string }[]>)
        : Promise.resolve([]),
    ]);
    return {
      service: {
        id: `${scheduleId}:${date}`,
        name: schedule.name,
        startTime: start,
        endTime: end,
        venue: null,
      },
      isLeader: access.isLeader,
      canPlan: access.canPlan,
      canPublish: access.canPublish,
      planRoles: access.planRoles,
      draft: access.canPlan
        ? await this.planAccess.draft(departmentId, { scheduleId, date })
        : null,
      assigned: assigned.map((row) => ({
        assignmentId: row.id,
        member: {
          id: row.member_id,
          name: row.name ?? 'Member',
          photoUrl: row.photo_url,
        },
        role: row.role,
        mine: row.member_id === memberId,
        leave: null,
        checkin: null,
        openCover: row.cover_id
          ? {
              id: row.cover_id,
              reason: row.cover_reason,
              forSomeone: !!row.cover_target,
            }
          : row.unavailable
            ? { id: `absence:${row.id}`, reason: null, forSomeone: false }
            : null,
      })),
      team: team.map((row) => ({
        id: row.id,
        name: row.name ?? 'Member',
        photoUrl: row.photo_url,
        servingElsewhere: row.elsewhere,
        leave: row.leave,
        unavailable: row.unavailable,
      })),
      previous: previous.map((row) => ({
        memberId: row.member_id,
        role: row.role,
      })),
    };
  }

  async save(
    memberId: string,
    departmentId: string,
    scheduleId: string,
    date: string,
    entries: RotaEntryDto[],
    now = new Date(),
  ) {
    const access = await this.planAccess.of(memberId, departmentId);
    if (!access.canPublish)
      throw new ForbiddenException(
        'Only a department lead or planner allowed to publish can save this rota.',
      );
    const current = (await this.assignments.query(
      `SELECT member_id, role FROM rota_custom_assignments WHERE schedule_id = $1 AND occurrence_date = $2::date`,
      [scheduleId, date],
    )) as { member_id: string; role: string | null }[];
    const merged = this.planAccess.merge(
      access.publishRoles,
      current.map((row) => ({ memberId: row.member_id, role: row.role })),
      entries,
    );
    await this.applySession(
      memberId,
      departmentId,
      scheduleId,
      date,
      merged,
      now,
      true,
    );
    if (!access.publishRoles)
      await this.planAccess.clearDraft(departmentId, { scheduleId, date });
    return this.detail(memberId, departmentId, scheduleId, date);
  }

  // Keeps rows for people who stay, so their open cover requests survive an edit.
  async applySession(
    memberId: string,
    departmentId: string,
    scheduleId: string,
    date: string,
    entries: { memberId: string; role?: string | null }[],
    now = new Date(),
    notify = false,
  ): Promise<RotaChange> {
    const schedule = await this.schedule(scheduleId, departmentId);
    const { start } = await this.occurrence(schedule, date);
    if (start <= now)
      throw new BadRequestException(
        'This serving session has already started.',
      );
    const wanted = new Map(
      entries.map((entry) => [
        entry.memberId,
        entry.role?.trim().slice(0, 80) || null,
      ]),
    );
    if (wanted.size !== entries.length)
      throw new BadRequestException(
        'Each person can only serve once in this session.',
      );
    const team = wanted.size
      ? ((await this.assignments.query(
          `SELECT wp.member_id FROM worker_profiles wp JOIN members m ON m.id = wp.member_id
           WHERE wp.status = 'ACTIVE' AND m.status = 'ACTIVE' AND wp.member_id = ANY($2)
             AND (wp.department_id = $1 OR wp.secondary_department_id = $1)`,
          [departmentId, [...wanted.keys()]],
        )) as { member_id: string }[])
      : [];
    if (team.length !== wanted.size)
      throw new BadRequestException(
        'Only active workers in this department can be on its rota.',
      );
    const existing = (await this.assignments.query(
      `SELECT id, member_id, role FROM rota_custom_assignments WHERE schedule_id = $1 AND occurrence_date = $2::date`,
      [scheduleId, date],
    )) as { id: string; member_id: string; role: string | null }[];
    const current = new Set(existing.map((row) => row.member_id));
    const removed = existing.filter((row) => !wanted.has(row.member_id));
    const added = [...wanted.keys()].filter((id) => !current.has(id));
    const changed = existing.filter(
      (row) =>
        wanted.has(row.member_id) &&
        (wanted.get(row.member_id) ?? null) !== (row.role ?? null),
    );
    const manager = this.txHost.tx;
    if (removed.length)
      await manager.query(
        `DELETE FROM rota_custom_assignments WHERE id = ANY($1)`,
        [removed.map((row) => row.id)],
      );
    if (added.length)
      await manager.query(
        `INSERT INTO rota_custom_assignments
           (schedule_id, occurrence_date, member_id, responsibility_id, role, assigned_by_id)
         SELECT $1, $2::date, x.member_id,
           (SELECT r.id FROM rota_responsibilities r WHERE r.department_id = $5 AND r.name = x.role),
           x.role, $6
         FROM unnest($3::uuid[], $4::varchar[]) AS x(member_id, role)`,
        [
          scheduleId,
          date,
          added,
          added.map((id) => wanted.get(id) ?? null),
          departmentId,
          memberId,
        ],
      );
    if (changed.length)
      await manager.query(
        `UPDATE rota_custom_assignments a SET role = x.role, updated_at = now(),
           responsibility_id = (SELECT r.id FROM rota_responsibilities r WHERE r.department_id = $3 AND r.name = x.role)
         FROM unnest($1::uuid[], $2::varchar[]) AS x(id, role) WHERE a.id = x.id`,
        [
          changed.map((row) => row.id),
          changed.map((row) => wanted.get(row.member_id) ?? null),
          departmentId,
        ],
      );
    if (added.length) void this.gate.wake(['rota-reminders']);
    this.audit.log('ROTA_UPDATED', {
      actorId: memberId,
      targetId: scheduleId,
      targetName: `${schedule.name}: ${date}`,
      metadata: {
        departmentId,
        custom: true,
        added: added.length,
        removed: removed.length,
      },
    });
    const change: RotaChange = {
      label: schedule.name,
      start,
      added: added.map((id) => ({
        memberId: id,
        role: wanted.get(id) ?? null,
      })),
      removed: removed.map((row) => row.member_id),
    };
    if (!notify) return change;
    const vars = await this.pushVars(schedule.name, start, departmentId);
    const byRole = new Map<string, string[]>();
    for (const person of change.added) {
      const role = person.role ?? '';
      byRole.set(role, [...(byRole.get(role) ?? []), person.memberId]);
    }
    for (const [role, ids] of byRole)
      this.notify(
        ids,
        PushNotificationKey.ROTA_ASSIGNED,
        { ...vars, role: role ? ` · ${role}` : '' },
        `/rota/department/${departmentId}/custom/${scheduleId}/${date}`,
        `custom-rota-added:${scheduleId}:${date}:${role}:${now.getTime()}`,
      );
    this.notify(
      change.removed,
      PushNotificationKey.ROTA_REMOVED,
      { ...vars, role: '' },
      '/rota',
      `custom-rota-removed:${scheduleId}:${date}:${now.getTime()}`,
    );
    return change;
  }

  private async pushVars(name: string, start: Date, departmentId: string) {
    const departments = (await this.assignments.query(
      `SELECT name FROM departments WHERE id = $1`,
      [departmentId],
    )) as { name: string }[];
    return {
      service_name: name,
      when: this.dateService.format(
        start,
        'EEE d MMM, h:mm a',
        await this.churchTimezone.get(),
      ),
      department_name: departments[0]?.name ?? 'your department',
    };
  }

  async markAbsent(memberId: string, assignmentId: string) {
    const rows = (await this.assignments.query(
      `SELECT a.id, a.occurrence_date::text AS occurrence_date, s.id AS schedule_id,
         s.department_id, s.name, s.start_time::text, ${NAME_SQL('m')} AS member_name
       FROM rota_custom_assignments a JOIN rota_schedules s ON s.id = a.schedule_id
       JOIN members m ON m.id = a.member_id
       WHERE a.id = $1 AND a.member_id = $2`,
      [assignmentId, memberId],
    )) as {
      id: string;
      occurrence_date: string;
      schedule_id: string;
      department_id: string;
      name: string;
      start_time: string;
      member_name: string | null;
    }[];
    const row = rows[0];
    if (!row) throw new NotFoundException('Duty not found.');
    await this.assignments.query(
      `INSERT INTO rota_unavailability (member_id, date)
       VALUES ($1, $2::date)
       ON CONFLICT (member_id, date) DO UPDATE SET updated_at = now()`,
      [memberId, row.occurrence_date],
    );
    const recipients = (await this.assignments.query(
      `SELECT DISTINCT recipient FROM (
         SELECT lw.member_id AS recipient FROM department_leads l
         JOIN worker_profiles lw ON lw.id = l.worker_profile_id WHERE l.department_id = $1
         UNION
         SELECT p.member_id FROM rota_planner_grants p
         WHERE p.department_id = $1 AND p.can_publish = true
       ) x WHERE recipient <> $2`,
      [row.department_id, memberId],
    )) as { recipient: string }[];
    this.notifications
      .notifyMember({
        category: EmailCategory.SERVING_ROTA,
        push: {
          memberIds: recipients.map((item) => item.recipient),
          key: PushNotificationKey.ROTA_COVER_NEEDED,
          vars: {
            requester: row.member_name ?? 'A teammate',
            service_name: row.name,
            when: this.dateService.format(
              fromZonedTime(
                `${row.occurrence_date}T${row.start_time.slice(0, 8)}`,
                await this.churchTimezone.get(),
              ),
              'EEE d MMM, h:mm a',
              await this.churchTimezone.get(),
            ),
            role: '',
          },
          url: `/rota/department/${row.department_id}/custom/${row.schedule_id}/${row.occurrence_date}`,
          idempotencyKey: `custom-rota-absent:${assignmentId}`,
        },
      })
      .catch(() => undefined);
    return { ok: true };
  }

  private async access(memberId: string, departmentId: string) {
    const access = await this.planAccess.of(memberId, departmentId);
    if (!access.isLeader && !access.isMember && !access.canPlan)
      throw new ForbiddenException("This isn't one of your departments.");
    return access;
  }

  private async schedule(id: string, departmentId: string) {
    const rows = (await this.assignments.query(
      `SELECT id, name, day_of_week, start_time::text, end_time::text
       FROM rota_schedules WHERE id = $1 AND department_id = $2
         AND schedule_type = $3 AND active = true`,
      [id, departmentId, RotaScheduleType.CUSTOM],
    )) as ScheduleRow[];
    if (!rows[0]) throw new NotFoundException('Serving schedule not found.');
    return rows[0];
  }

  private async occurrence(schedule: ScheduleRow, date: string) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      this.weekday(date) !== schedule.day_of_week
    )
      throw new BadRequestException(
        "That date doesn't match this serving schedule.",
      );
    const timezone = await this.churchTimezone.get();
    return {
      start: fromZonedTime(
        `${date}T${schedule.start_time.slice(0, 8)}`,
        timezone,
      ),
      end: fromZonedTime(`${date}T${schedule.end_time.slice(0, 8)}`, timezone),
    };
  }

  private weekday(date: string) {
    return new Date(`${date}T00:00:00Z`).getUTCDay();
  }

  private notify(
    memberIds: string[],
    key: PushNotificationKey,
    vars: Record<string, string>,
    url: string,
    idempotencyKey: string,
  ) {
    if (!memberIds.length) return;
    this.notifications
      .notifyMember({
        category: EmailCategory.SERVING_ROTA,
        push: { memberIds, key, vars, url, idempotencyKey },
      })
      .catch(() => undefined);
  }
}
