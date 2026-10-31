import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import { RotaAssignment } from '../entity/rota-assignment.entity';
import { RequestCoverDto } from '../dto/serving-rota.dto';
import { ChurchTimezoneService } from '../../utility/service/church-timezone.service';
import { DateService } from '../../utility/service/date.service';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';
import { AuditLogService } from '../../utility/service/audit-log.service';

const WORKLOAD_DAYS = 56;
const DAY_MS = 24 * 3600 * 1000;

export interface CoverOption {
  id: string;
  name: string;
  photoUrl: string | null;
  matchesRole: boolean;
}

interface CustomDuty {
  id: string;
  member_id: string;
  role: string | null;
  occurrence_date: string;
  schedule_id: string;
  name: string;
  start_time: string;
  end_time: string;
  department_id: string;
  department_name: string;
  member_name: string | null;
}

@Injectable()
export class RotaCoverService {
  constructor(
    @InjectRepository(RotaAssignment)
    private readonly repo: Repository<RotaAssignment>,
    private readonly churchTimezone: ChurchTimezoneService,
    private readonly dateService: DateService,
    private readonly notifications: NotificationDispatchService,
    private readonly audit: AuditLogService,
  ) {}

  // Who could step in, best first: right for the responsibility, free then, least recently busy.
  async options(input: {
    departmentId: string;
    role: string | null;
    date: string;
    start: Date;
    end: Date;
    exclude: string[];
  }): Promise<CoverOption[]> {
    const timezone = await this.churchTimezone.get();
    const rows = (await this.repo.query(
      `SELECT m.id, NULLIF(TRIM(COALESCE(m.firstname, '') || ' ' || COALESCE(m.lastname, '')), '') AS name,
         m.photo_url,
         EXISTS (SELECT 1 FROM rota_responsibility_members rm JOIN rota_responsibilities r ON r.id = rm.responsibility_id
                 WHERE r.department_id = $1 AND r.name = $2 AND rm.member_id = m.id) AS matches_role
       FROM worker_profiles wp JOIN members m ON m.id = wp.member_id
       WHERE wp.status = 'ACTIVE' AND m.status = 'ACTIVE'
         AND (wp.department_id = $1 OR wp.secondary_department_id = $1)
         AND m.id <> ALL($7::uuid[])
         AND NOT EXISTS (SELECT 1 FROM request_leave rl JOIN worker_profiles lw ON lw.id = rl.worker_profile_id
                         WHERE lw.member_id = m.id AND rl.status = 'APPROVED' AND $3::date BETWEEN rl.date_from AND rl.date_to)
         AND NOT EXISTS (SELECT 1 FROM rota_unavailability u WHERE u.member_id = m.id AND u.date = $3::date)
         AND NOT EXISTS (SELECT 1 FROM rota_assignments o JOIN service_slots os ON os.id = o.service_slot_id
                         WHERE o.member_id = m.id AND os.start_time < $5 AND os.end_time > $4)
         AND NOT EXISTS (SELECT 1 FROM rota_custom_assignments c JOIN rota_schedules cs ON cs.id = c.schedule_id
                         WHERE c.member_id = m.id AND c.occurrence_date = $3::date
                           AND cs.start_time < $9::time AND cs.end_time > $8::time)
         AND (
           NOT EXISTS (SELECT 1 FROM rota_responsibility_members rm JOIN rota_responsibilities r ON r.id = rm.responsibility_id
                       WHERE r.department_id = $1 AND r.name = $2)
           OR EXISTS (SELECT 1 FROM rota_responsibility_members rm JOIN rota_responsibilities r ON r.id = rm.responsibility_id
                      WHERE r.department_id = $1 AND r.name = $2 AND rm.member_id = m.id))
       ORDER BY
         (SELECT count(*) FROM rota_assignments ra JOIN service_slots rs ON rs.id = ra.service_slot_id
          WHERE ra.member_id = m.id AND rs.start_time >= $6 AND rs.start_time < $4)
         + (SELECT count(*) FROM rota_custom_assignments rc
            WHERE rc.member_id = m.id AND rc.occurrence_date >= $6::date AND rc.occurrence_date < $3::date),
         name`,
      [
        input.departmentId,
        input.role ?? '',
        input.date,
        input.start,
        input.end,
        new Date(input.start.getTime() - WORKLOAD_DAYS * DAY_MS),
        input.exclude,
        formatInTimeZone(input.start, timezone, 'HH:mm:ss'),
        formatInTimeZone(input.end, timezone, 'HH:mm:ss'),
      ],
    )) as {
      id: string;
      name: string | null;
      photo_url: string | null;
      matches_role: boolean;
    }[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name ?? 'Member',
      photoUrl: row.photo_url,
      matchesRole: !!row.matches_role,
    }));
  }

  async customOptions(memberId: string, assignmentId: string) {
    const duty = await this.customDuty(assignmentId);
    if (duty.member_id !== memberId)
      throw new ForbiddenException('You can only ask cover for your own duty.');
    const { start, end } = await this.times(duty);
    return this.options({
      departmentId: duty.department_id,
      role: duty.role,
      date: duty.occurrence_date,
      start,
      end,
      exclude: await this.onSession(duty),
    });
  }

  async requestCustom(
    memberId: string,
    assignmentId: string,
    dto: RequestCoverDto,
    now = new Date(),
  ) {
    const duty = await this.customDuty(assignmentId);
    if (duty.member_id !== memberId)
      throw new ForbiddenException('You can only ask cover for your own duty.');
    const { start, end } = await this.times(duty);
    if (start <= now)
      throw new BadRequestException('This session has already started.');
    const open = (await this.repo.query(
      `SELECT 1 FROM rota_cover_requests WHERE custom_assignment_id = $1 AND status = 'OPEN'`,
      [assignmentId],
    )) as unknown[];
    if (open.length)
      throw new ConflictException("You've already asked for cover for this.");
    const options = await this.options({
      departmentId: duty.department_id,
      role: duty.role,
      date: duty.occurrence_date,
      start,
      end,
      exclude: await this.onSession(duty),
    });
    if (dto.targetMemberId && !options.some((o) => o.id === dto.targetMemberId))
      throw new BadRequestException(
        "They can't cover this. Pick someone else.",
      );
    const saved = (await this.repo.query(
      `INSERT INTO rota_cover_requests (custom_assignment_id, department_id, requested_by_id, target_member_id, reason)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        assignmentId,
        duty.department_id,
        memberId,
        dto.targetMemberId ?? null,
        dto.reason?.trim().slice(0, 300) || null,
      ],
    )) as { id: string }[];
    const recipients = dto.targetMemberId
      ? [dto.targetMemberId]
      : options.map((o) => o.id);
    this.push(
      recipients,
      PushNotificationKey.ROTA_COVER_NEEDED,
      {
        requester: duty.member_name ?? 'A teammate',
        service_name: duty.name,
        when: await this.when(start),
        role: duty.role ? ` · ${duty.role}` : '',
      },
      `rota-custom-cover:${saved[0].id}`,
    );
    return { id: saved[0].id, notified: recipients.length };
  }

  // The first to accept takes the duty. The caller holds the row lock on the request.
  async acceptCustom(
    memberId: string,
    request: { id: string; customAssignmentId: string },
    query: (sql: string, params: unknown[]) => Promise<unknown>,
    now = new Date(),
  ) {
    const duty = await this.customDuty(request.customAssignmentId);
    const { start, end } = await this.times(duty);
    if (start <= now)
      throw new BadRequestException('This session has already started.');
    const rows = (await this.repo.query(
      `SELECT requested_by_id, target_member_id FROM rota_cover_requests WHERE id = $1`,
      [request.id],
    )) as {
      requested_by_id: string | null;
      target_member_id: string | null;
    }[];
    const row = rows[0];
    if (row.requested_by_id === memberId)
      throw new BadRequestException("You can't cover your own duty.");
    if (row.target_member_id && row.target_member_id !== memberId)
      throw new ForbiddenException('This request was sent to someone else.');
    const options = await this.options({
      departmentId: duty.department_id,
      role: duty.role,
      date: duty.occurrence_date,
      start,
      end,
      exclude: await this.onSession(duty),
    });
    if (!options.some((o) => o.id === memberId))
      throw new ConflictException(
        "You can't take this: you're busy that day or not set up for this responsibility.",
      );
    await query(
      `UPDATE rota_custom_assignments SET member_id = $2, updated_at = now() WHERE id = $1`,
      [duty.id, memberId],
    );
    await query(
      `UPDATE rota_cover_requests SET status = 'ACCEPTED', accepted_by_id = $2, resolved_at = $3, updated_at = now() WHERE id = $1`,
      [request.id, memberId, now],
    );
    const leads = (await this.repo.query(
      `SELECT lw.member_id FROM department_leads l JOIN worker_profiles lw ON lw.id = l.worker_profile_id WHERE l.department_id = $1`,
      [duty.department_id],
    )) as { member_id: string }[];
    const volunteer = (await this.repo.query(
      `SELECT NULLIF(TRIM(COALESCE(firstname, '') || ' ' || COALESCE(lastname, '')), '') AS name FROM members WHERE id = $1`,
      [memberId],
    )) as { name: string | null }[];
    this.push(
      [
        ...new Set([row.requested_by_id, ...leads.map((l) => l.member_id)]),
      ].filter((id): id is string => !!id && id !== memberId),
      PushNotificationKey.ROTA_COVER_TAKEN,
      {
        volunteer: volunteer[0]?.name ?? 'A teammate',
        service_name: duty.name,
        when: await this.when(start),
        role: duty.role ? ` · ${duty.role}` : '',
        department_name: duty.department_name,
      },
      `rota-custom-cover-taken:${request.id}`,
    );
    this.audit.log('ROTA_COVER_ACCEPTED', {
      actorId: memberId,
      targetId: row.requested_by_id ?? undefined,
      targetName: `${duty.department_name}: ${duty.name}`,
      metadata: { requestId: request.id, customAssignmentId: duty.id },
    });
    return { ok: true };
  }

  private async onSession(duty: CustomDuty): Promise<string[]> {
    const rows = (await this.repo.query(
      `SELECT member_id FROM rota_custom_assignments WHERE schedule_id = $1 AND occurrence_date = $2::date`,
      [duty.schedule_id, duty.occurrence_date],
    )) as { member_id: string }[];
    return rows.map((r) => r.member_id);
  }

  private async customDuty(assignmentId: string): Promise<CustomDuty> {
    const rows = (await this.repo.query(
      `SELECT a.id, a.member_id, a.role, a.occurrence_date::text AS occurrence_date, s.id AS schedule_id,
         s.name, s.start_time::text, s.end_time::text, d.id AS department_id, d.name AS department_name,
         NULLIF(TRIM(COALESCE(m.firstname, '') || ' ' || COALESCE(m.lastname, '')), '') AS member_name
       FROM rota_custom_assignments a JOIN rota_schedules s ON s.id = a.schedule_id
       JOIN departments d ON d.id = s.department_id JOIN members m ON m.id = a.member_id
       WHERE a.id = $1`,
      [assignmentId],
    )) as CustomDuty[];
    if (!rows[0]) throw new NotFoundException('Duty not found');
    return rows[0];
  }

  private async times(duty: CustomDuty) {
    const timezone = await this.churchTimezone.get();
    return {
      start: fromZonedTime(
        `${duty.occurrence_date}T${duty.start_time.slice(0, 8)}`,
        timezone,
      ),
      end: fromZonedTime(
        `${duty.occurrence_date}T${duty.end_time.slice(0, 8)}`,
        timezone,
      ),
    };
  }

  private async when(start: Date): Promise<string> {
    return this.dateService.format(
      start,
      'EEE d MMM, h:mm a',
      await this.churchTimezone.get(),
    );
  }

  private push(
    memberIds: string[],
    key: PushNotificationKey,
    vars: Record<string, string>,
    idempotencyKey: string,
  ) {
    if (!memberIds.length) return;
    this.notifications
      .notifyMember({
        category: EmailCategory.SERVING_ROTA,
        push: { memberIds, key, vars, url: '/rota', idempotencyKey },
      })
      .catch(() => undefined);
  }
}
