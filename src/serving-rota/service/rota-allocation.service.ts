import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RotaAssignment } from '../entity/rota-assignment.entity';
import { RotaUnavailability } from '../entity/rota-unavailability.entity';
import { RotaEntryDto, SaveRotaUnavailabilityDto } from '../dto/serving-rota.dto';
import { RotaAllocationMode } from '../enum/rota-allocation-mode.enum';
import { ChurchTimezoneService } from '../../utility/service/church-timezone.service';
import { localDate } from '../../event/types/slot-blueprint';
import { fromZonedTime } from 'date-fns-tz';

interface CandidateRow {
  responsibility_id: string;
  responsibility_name: string;
  required_count: number;
  allocation_mode: RotaAllocationMode;
  subteam_id: string | null;
  member_id: string | null;
  is_fixed: boolean | null;
  leave: 'APPROVED' | 'PENDING' | null;
  unavailable: boolean | null;
  conflict: string | null;
  workload: number | null;
  last_served: Date | null;
}

@Injectable()
export class RotaAllocationService {
  constructor(
    @InjectRepository(RotaAssignment)
    private readonly assignments: Repository<RotaAssignment>,
    @InjectRepository(RotaUnavailability)
    private readonly unavailability: Repository<RotaUnavailability>,
    private readonly churchTimezone: ChurchTimezoneService,
  ) {}

  async generate(
    memberId: string,
    departmentId: string,
    slotId: string,
    lockedEntries: RotaEntryDto[] = [],
    now = new Date(),
  ) {
    const scopes = await this.planningScopes(memberId, departmentId);
    const slotRows = (await this.assignments.query(
      `SELECT ss.id, ss.start_time, ss.end_time FROM service_slots ss WHERE ss.id = $1`,
      [slotId],
    )) as { id: string; start_time: Date; end_time: Date }[];
    const slot = slotRows[0];
    if (!slot) throw new NotFoundException('Service not found.');
    if (new Date(slot.start_time) <= now)
      throw new BadRequestException('This service has already started.');
    const date = localDate(
      new Date(slot.start_time),
      await this.churchTimezone.get(),
    );
    const scopeIds = scopes.all ? null : scopes.subteamIds;
    const rows = (await this.assignments.query(
      `SELECT r.id AS responsibility_id, r.name AS responsibility_name, r.required_count,
         r.allocation_mode, r.subteam_id, rm.member_id, rm.is_fixed,
         (SELECT rl.status FROM request_leave rl JOIN worker_profiles lw ON lw.id = rl.worker_profile_id
          WHERE lw.member_id = rm.member_id AND rl.status IN ('APPROVED', 'PENDING')
            AND $3::date BETWEEN rl.date_from AND rl.date_to
          ORDER BY (rl.status = 'APPROVED') DESC LIMIT 1) AS leave,
         EXISTS (SELECT 1 FROM rota_unavailability u WHERE u.member_id = rm.member_id AND u.date = $3::date) AS unavailable,
         (SELECT string_agg(d.name, ', ' ORDER BY d.name) FROM rota_assignments other
          JOIN departments d ON d.id = other.department_id
          WHERE other.service_slot_id = $2 AND other.member_id = rm.member_id AND other.department_id <> $1) AS conflict,
         (SELECT count(*)::int FROM rota_assignments recent JOIN service_slots rs ON rs.id = recent.service_slot_id
          WHERE recent.member_id = rm.member_id AND rs.start_time >= $4 AND rs.start_time < $5) AS workload,
         (SELECT max(rs.start_time) FROM rota_assignments recent JOIN service_slots rs ON rs.id = recent.service_slot_id
          WHERE recent.member_id = rm.member_id AND rs.start_time < $5) AS last_served
       FROM rota_responsibilities r
       LEFT JOIN rota_responsibility_members rm ON rm.responsibility_id = r.id
       WHERE r.department_id = $1 AND ($6::uuid[] IS NULL OR r.subteam_id = ANY($6))
       ORDER BY r.position, r.name, rm.is_fixed DESC, workload, last_served NULLS FIRST, rm.member_id`,
      [
        departmentId,
        slotId,
        date,
        new Date(new Date(slot.start_time).getTime() - 56 * 24 * 3600 * 1000),
        slot.start_time,
        scopeIds,
      ],
    )) as CandidateRow[];
    if (!rows.length)
      throw new BadRequestException(
        'Add responsibilities and eligible people in Rota setup first.',
      );

    return this.allocate(rows, lockedEntries, date);
  }

  async generateCustom(
    memberId: string,
    departmentId: string,
    scheduleId: string,
    date: string,
    lockedEntries: RotaEntryDto[] = [],
    now = new Date(),
  ) {
    const scopes = await this.planningScopes(memberId, departmentId);
    const scheduleRows = (await this.assignments.query(
      `SELECT id, day_of_week, start_time::text, end_time::text
       FROM rota_schedules WHERE id = $1 AND department_id = $2
         AND schedule_type = 'CUSTOM' AND active = true`,
      [scheduleId, departmentId],
    )) as {
      id: string;
      day_of_week: number;
      start_time: string;
      end_time: string;
    }[];
    const schedule = scheduleRows[0];
    if (
      !schedule ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      new Date(`${date}T00:00:00Z`).getUTCDay() !== schedule.day_of_week
    )
      throw new NotFoundException('Serving session not found.');
    const timezone = await this.churchTimezone.get();
    const start = fromZonedTime(
      `${date}T${schedule.start_time.slice(0, 8)}`,
      timezone,
    );
    const end = fromZonedTime(
      `${date}T${schedule.end_time.slice(0, 8)}`,
      timezone,
    );
    if (start <= now)
      throw new BadRequestException('This serving session has already started.');
    const scopeIds = scopes.all ? null : scopes.subteamIds;
    const rows = (await this.assignments.query(
      `SELECT r.id AS responsibility_id, r.name AS responsibility_name, r.required_count,
         r.allocation_mode, r.subteam_id, rm.member_id, rm.is_fixed,
         (SELECT rl.status FROM request_leave rl JOIN worker_profiles lw ON lw.id = rl.worker_profile_id
          WHERE lw.member_id = rm.member_id AND rl.status IN ('APPROVED', 'PENDING')
            AND $3::date BETWEEN rl.date_from AND rl.date_to
          ORDER BY (rl.status = 'APPROVED') DESC LIMIT 1) AS leave,
         EXISTS (SELECT 1 FROM rota_unavailability u WHERE u.member_id = rm.member_id AND u.date = $3::date) AS unavailable,
         (SELECT string_agg(DISTINCT conflict.name, ', ' ORDER BY conflict.name) FROM (
            SELECT d.name FROM rota_assignments other JOIN service_slots ss ON ss.id = other.service_slot_id
            JOIN departments d ON d.id = other.department_id
            WHERE other.member_id = rm.member_id AND ss.start_time < $5 AND ss.end_time > $4
            UNION ALL
            SELECT os.name FROM rota_custom_assignments ca JOIN rota_schedules os ON os.id = ca.schedule_id
            WHERE ca.member_id = rm.member_id AND ca.occurrence_date = $3::date
              AND ca.schedule_id <> $2 AND os.start_time < $7::time AND os.end_time > $6::time
          ) conflict) AS conflict,
         ((SELECT count(*) FROM rota_assignments recent JOIN service_slots rs ON rs.id = recent.service_slot_id
           WHERE recent.member_id = rm.member_id AND rs.start_time >= $8 AND rs.start_time < $4) +
          (SELECT count(*) FROM rota_custom_assignments recent
           WHERE recent.member_id = rm.member_id AND recent.occurrence_date >= $9::date AND recent.occurrence_date < $3::date))::int AS workload,
         NULL::timestamptz AS last_served
       FROM rota_responsibilities r
       LEFT JOIN rota_responsibility_members rm ON rm.responsibility_id = r.id
       WHERE r.department_id = $1 AND ($10::uuid[] IS NULL OR r.subteam_id = ANY($10))
       ORDER BY r.position, r.name, rm.is_fixed DESC, workload, rm.member_id`,
      [
        departmentId,
        scheduleId,
        date,
        start,
        end,
        schedule.start_time,
        schedule.end_time,
        new Date(start.getTime() - 56 * 24 * 3600 * 1000),
        localDate(new Date(start.getTime() - 56 * 24 * 3600 * 1000), timezone),
        scopeIds,
      ],
    )) as CandidateRow[];
    if (!rows.length)
      throw new BadRequestException(
        'Add responsibilities and eligible people in Rota setup first.',
      );
    return this.allocate(rows, lockedEntries, date);
  }

  private allocate(
    rows: CandidateRow[],
    lockedEntries: RotaEntryDto[],
    date: string,
  ) {
    const locked = new Map(
      lockedEntries.map((entry) => [entry.memberId, entry.role]),
    );
    const chosen = new Set(locked.keys());
    const entries = lockedEntries.map((entry) => ({ ...entry, locked: true }));
    const gaps: { responsibilityId: string; responsibility: string; count: number; reason: string }[] = [];
    const grouped = new Map<string, CandidateRow[]>();
    for (const row of rows)
      grouped.set(row.responsibility_id, [
        ...(grouped.get(row.responsibility_id) ?? []),
        row,
      ]);

    for (const candidates of grouped.values()) {
      const responsibility = candidates[0];
      const already = lockedEntries.filter(
        (entry) => entry.role === responsibility.responsibility_name,
      ).length;
      let needed = Math.max(0, responsibility.required_count - already);
      if (!needed) continue;
      if (responsibility.allocation_mode === RotaAllocationMode.MANUAL) {
        gaps.push({
          responsibilityId: responsibility.responsibility_id,
          responsibility: responsibility.responsibility_name,
          count: needed,
          reason: 'Choose manually',
        });
        continue;
      }
      const available = candidates.filter(
        (candidate) =>
          !!candidate.member_id &&
          !chosen.has(candidate.member_id) &&
          candidate.leave !== 'APPROVED' &&
          !candidate.unavailable &&
          !candidate.conflict &&
          (responsibility.allocation_mode !== RotaAllocationMode.FIXED ||
            candidate.is_fixed),
      );
      for (const candidate of available.slice(0, needed)) {
        chosen.add(candidate.member_id as string);
        entries.push({
          memberId: candidate.member_id as string,
          role: responsibility.responsibility_name,
          locked: false,
        });
        needed -= 1;
      }
      if (needed)
        gaps.push({
          responsibilityId: responsibility.responsibility_id,
          responsibility: responsibility.responsibility_name,
          count: needed,
          reason:
            responsibility.allocation_mode === RotaAllocationMode.FIXED
              ? 'Fixed person unavailable'
              : 'No eligible person available',
        });
    }
    return { entries, gaps, date };
  }

  async mine(memberId: string, now = new Date()) {
    const today = localDate(now, await this.churchTimezone.get());
    return this.unavailability.find({
      where: { member: { id: memberId } },
      order: { date: 'ASC' },
    }).then((rows) => rows.filter((row) => row.date >= today));
  }

  async saveUnavailable(
    memberId: string,
    dto: SaveRotaUnavailabilityDto,
    now = new Date(),
  ) {
    const today = localDate(now, await this.churchTimezone.get());
    if (dto.date < today)
      throw new BadRequestException("You can't mark a past date unavailable.");
    await this.unavailability.query(
      `INSERT INTO rota_unavailability (member_id, date, reason)
       VALUES ($1, $2, $3)
       ON CONFLICT (member_id, date) DO UPDATE
       SET reason = EXCLUDED.reason, updated_at = now()`,
      [memberId, dto.date, dto.reason?.trim() || null],
    );
    return { ok: true };
  }

  async removeUnavailable(memberId: string, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new BadRequestException('Use a date in YYYY-MM-DD format.');
    await this.unavailability.delete({ member: { id: memberId }, date });
    return { ok: true };
  }

  private async planningScopes(memberId: string, departmentId: string) {
    const rows = (await this.assignments.query(
      `SELECT
         EXISTS (SELECT 1 FROM department_leads l JOIN worker_profiles lw ON lw.id = l.worker_profile_id
                 WHERE l.department_id = $2 AND lw.member_id = $1) AS is_leader,
         ARRAY(SELECT p.subteam_id FROM rota_planner_grants p
               WHERE p.department_id = $2 AND p.member_id = $1 AND p.subteam_id IS NOT NULL) AS subteam_ids,
         EXISTS (SELECT 1 FROM rota_planner_grants p
                 WHERE p.department_id = $2 AND p.member_id = $1 AND p.subteam_id IS NULL) AS all_scope`,
      [memberId, departmentId],
    )) as { is_leader: boolean; subteam_ids: string[]; all_scope: boolean }[];
    const row = rows[0];
    if (!row?.is_leader && !row?.all_scope && !row?.subteam_ids.length)
      throw new ForbiddenException(
        'Only a department lead or delegated rota planner can generate this rota.',
      );
    return {
      all: !!row.is_leader || !!row.all_scope,
      subteamIds: row.subteam_ids,
    };
  }
}
