import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { RotaAssignment } from '../entity/rota-assignment.entity';
import {
  CoverStatusEnum,
  RotaCoverRequest,
} from '../entity/rota-cover-request.entity';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { DateService } from '../../utility/service/date.service';
import { ChurchTimezoneService } from '../../utility/service/church-timezone.service';
import { RotaEntryDto, RequestCoverDto } from '../dto/serving-rota.dto';

const DAY_MS = 24 * 3600 * 1000;
// How far ahead leaders plan and workers see their duties.
export const PLAN_AHEAD_DAYS = 56;

interface SlotRow {
  slot_id: string;
  name: string;
  start_time: Date;
  end_time: Date;
  event_name: string;
  venue: string | null;
}

// A service's name, times and venue: the slot's own venue, else its config's default.
const SLOT_COLS = `ss.id AS slot_id, ss.name, ss.start_time, ss.end_time, e.name AS event_name, COALESCE(vo.name, v.name) AS venue`;
const SLOT_JOINS = `JOIN events e ON e.id = ss.event_id
  LEFT JOIN event_config ec ON ec.id = ss.config_id
  LEFT JOIN venues v ON v.id = ec.default_venue_id
  LEFT JOIN venues vo ON vo.id = ss.venue_override_id`;

const NAME_SQL = (a: string) =>
  `NULLIF(TRIM(COALESCE(${a}.firstname, '') || ' ' || COALESCE(${a}.lastname, '')), '')`;

export function serviceName(slot: {
  name: string;
  event_name: string;
}): string {
  return slot.event_name && slot.event_name !== slot.name
    ? `${slot.event_name} · ${slot.name}`
    : slot.name;
}

@Injectable()
export class ServingRotaService {
  constructor(
    @InjectRepository(RotaAssignment)
    private readonly assignmentRepo: Repository<RotaAssignment>,
    @InjectRepository(RotaCoverRequest)
    private readonly coverRepo: Repository<RotaCoverRequest>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly notifications: NotificationDispatchService,
    private readonly audit: AuditLogService,
    private readonly dateService: DateService,
    private readonly churchTimezone: ChurchTimezoneService,
  ) {}

  // Departments the member serves in or leads.
  async departments(memberId: string) {
    const rows = (await this.assignmentRepo.query(
      `SELECT d.id, d.name,
         EXISTS (SELECT 1 FROM department_leads l JOIN worker_profiles lw ON lw.id = l.worker_profile_id
                 WHERE l.department_id = d.id AND lw.member_id = $1) AS is_leader
       FROM departments d
       WHERE d.id IN (
         SELECT wp.department_id FROM worker_profiles wp WHERE wp.member_id = $1 AND wp.status = 'ACTIVE'
         UNION SELECT wp.secondary_department_id FROM worker_profiles wp WHERE wp.member_id = $1 AND wp.status = 'ACTIVE'
         UNION SELECT l.department_id FROM department_leads l JOIN worker_profiles lw ON lw.id = l.worker_profile_id WHERE lw.member_id = $1
       )
       ORDER BY d.name`,
      [memberId],
    )) as { id: string; name: string; is_leader: boolean }[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      isLeader: !!r.is_leader,
    }));
  }

  // The next eight weeks of services, with how many are on this department's rota and any open cover requests.
  async services(memberId: string, departmentId: string, now = new Date()) {
    const role = await this.role(memberId, departmentId);
    const rows = (await this.assignmentRepo.query(
      `SELECT ${SLOT_COLS},
         (SELECT count(*)::int FROM rota_assignments a WHERE a.service_slot_id = ss.id AND a.department_id = $1) AS assigned,
         (SELECT count(*)::int FROM rota_cover_requests c JOIN rota_assignments a ON a.id = c.assignment_id
            WHERE a.service_slot_id = ss.id AND c.department_id = $1 AND c.status = 'OPEN') AS open_cover,
         EXISTS (SELECT 1 FROM rota_assignments a WHERE a.service_slot_id = ss.id AND a.department_id = $1 AND a.member_id = $4) AS mine
       FROM service_slots ss ${SLOT_JOINS}
       WHERE ss.start_time > $2 AND ss.start_time <= $3
       ORDER BY ss.start_time
       LIMIT 60`,
      [
        departmentId,
        now,
        new Date(now.getTime() + PLAN_AHEAD_DAYS * DAY_MS),
        memberId,
      ],
    )) as (SlotRow & { assigned: number; open_cover: number; mine: boolean })[];
    return {
      isLeader: role === 'leader',
      services: rows.map((r) => ({
        ...this.slot(r),
        assigned: r.assigned,
        openCover: r.open_cover,
        mine: !!r.mine,
      })),
    };
  }

  // One service's rota for a department, plus (for leaders) the team to choose from and the last rota to copy.
  async slotRota(memberId: string, departmentId: string, slotId: string) {
    const role = await this.role(memberId, departmentId);
    const slot = await this.findSlot(slotId);
    const [assigned, team, previous] = await Promise.all([
      this.assignmentRepo.query(
        `SELECT a.id, a.member_id, a.role, ${NAME_SQL('m')} AS name, m.photo_url,
           c.id AS cover_id, c.reason AS cover_reason, c.target_member_id AS cover_target
         FROM rota_assignments a
         JOIN members m ON m.id = a.member_id
         LEFT JOIN rota_cover_requests c ON c.assignment_id = a.id AND c.status = 'OPEN'
         WHERE a.service_slot_id = $1 AND a.department_id = $2
         ORDER BY a.role NULLS LAST, name`,
        [slotId, departmentId],
      ) as Promise<
        {
          id: string;
          member_id: string;
          role: string | null;
          name: string | null;
          photo_url: string | null;
          cover_id: string | null;
          cover_reason: string | null;
          cover_target: string | null;
        }[]
      >,
      // Everyone in the department sees the team, so a worker can ask one teammate for cover.
      this.team(departmentId, slotId),
      role === 'leader'
        ? (this.assignmentRepo.query(
            `SELECT a.member_id, a.role FROM rota_assignments a
             WHERE a.department_id = $1 AND a.service_slot_id = (
               SELECT pa.service_slot_id FROM rota_assignments pa JOIN service_slots ps ON ps.id = pa.service_slot_id
               WHERE pa.department_id = $1 AND ps.start_time < $2
               ORDER BY ps.start_time DESC LIMIT 1)`,
            [departmentId, slot.start_time],
          ) as Promise<{ member_id: string; role: string | null }[]>)
        : Promise.resolve([]),
    ]);
    return {
      service: this.slot(slot),
      isLeader: role === 'leader',
      assigned: assigned.map((a) => ({
        assignmentId: a.id,
        member: {
          id: a.member_id,
          name: a.name ?? 'Member',
          photoUrl: a.photo_url,
        },
        role: a.role,
        mine: a.member_id === memberId,
        openCover: a.cover_id
          ? {
              id: a.cover_id,
              reason: a.cover_reason,
              forSomeone: !!a.cover_target,
            }
          : null,
      })),
      team,
      previous: previous.map((p) => ({ memberId: p.member_id, role: p.role })),
    };
  }

  // Leaders set the whole rota for a service; people added or taken off are told.
  async saveSlotRota(
    memberId: string,
    departmentId: string,
    slotId: string,
    entries: RotaEntryDto[],
    now = new Date(),
  ) {
    if ((await this.role(memberId, departmentId)) !== 'leader')
      throw new ForbiddenException(
        "Only the department's HOD or Assistant HOD can change the rota.",
      );
    const slot = await this.findSlot(slotId);
    if (new Date(slot.start_time) <= now)
      throw new BadRequestException('This service has already started.');
    const wanted = new Map(
      entries.map((e) => [e.memberId, e.role?.trim().slice(0, 80) || null]),
    );
    const eligible = new Set(
      (
        (await this.assignmentRepo.query(
          `SELECT wp.member_id FROM worker_profiles wp JOIN members m ON m.id = wp.member_id
           WHERE wp.status = 'ACTIVE' AND m.status = 'ACTIVE' AND wp.member_id = ANY($2)
             AND (wp.department_id = $1 OR wp.secondary_department_id = $1)`,
          [departmentId, [...wanted.keys()]],
        )) as { member_id: string }[]
      ).map((r) => r.member_id),
    );
    const outsiders = [...wanted.keys()].filter((id) => !eligible.has(id));
    if (outsiders.length)
      throw new BadRequestException(
        'Only active workers in this department can be on its rota.',
      );

    const existing = (await this.assignmentRepo.query(
      `SELECT id, member_id, role FROM rota_assignments WHERE service_slot_id = $1 AND department_id = $2`,
      [slotId, departmentId],
    )) as { id: string; member_id: string; role: string | null }[];
    const current = new Map(existing.map((e) => [e.member_id, e]));
    const removed = existing.filter((e) => !wanted.has(e.member_id));
    const added = [...wanted.keys()].filter((id) => !current.has(id));
    const changed = existing.filter(
      (e) =>
        wanted.has(e.member_id) &&
        (wanted.get(e.member_id) ?? null) !== (e.role ?? null),
    );

    if (removed.length)
      await this.assignmentRepo.query(
        `DELETE FROM rota_assignments WHERE id = ANY($1)`,
        [removed.map((r) => r.id)],
      );
    if (added.length)
      await this.assignmentRepo.query(
        `INSERT INTO rota_assignments (department_id, service_slot_id, member_id, role, assigned_by_id)
         SELECT $1, $2, x.member_id, x.role, $5 FROM unnest($3::uuid[], $4::varchar[]) AS x(member_id, role)`,
        [
          departmentId,
          slotId,
          added,
          added.map((id) => wanted.get(id) ?? null),
          memberId,
        ],
      );
    for (const c of changed)
      await this.assignmentRepo.update(c.id, {
        role: wanted.get(c.member_id) ?? null,
      });

    const timezone = await this.churchTimezone.get();
    const department = await this.departmentName(departmentId);
    const vars = {
      service_name: serviceName(slot),
      when: this.dateService.format(
        new Date(slot.start_time),
        'EEE d MMM, h:mm a',
        timezone,
      ),
      department_name: department,
    };
    // One send per role, so each person's notification names their own role.
    const byRole = new Map<string, string[]>();
    for (const id of added) {
      const r = wanted.get(id) ?? '';
      byRole.set(r, [...(byRole.get(r) ?? []), id]);
    }
    for (const [r, ids] of byRole)
      this.push(
        ids,
        PushNotificationKey.ROTA_ASSIGNED,
        { ...vars, role: r ? ` · ${r}` : '' },
        `rota-added:${slotId}:${departmentId}:${r}:${now.getTime()}`,
      );
    if (removed.length)
      this.push(
        removed.map((r) => r.member_id),
        PushNotificationKey.ROTA_REMOVED,
        vars,
        `rota-removed:${slotId}:${departmentId}:${now.getTime()}`,
      );

    this.audit.log('ROTA_UPDATED', {
      actorId: memberId,
      targetId: slotId,
      targetName: `${department}: ${serviceName(slot)}`,
      metadata: {
        departmentId,
        added: added.length,
        removed: removed.length,
        changed: changed.length,
      },
    });
    return this.slotRota(memberId, departmentId, slotId);
  }

  // The member's own duties ahead, and cover requests they could take.
  async mine(memberId: string, now = new Date()) {
    const until = new Date(now.getTime() + PLAN_AHEAD_DAYS * DAY_MS);
    const [duties, requests] = await Promise.all([
      this.assignmentRepo.query(
        `SELECT a.id AS assignment_id, a.role, d.id AS department_id, d.name AS department_name,
           c.id AS cover_id, c.reason AS cover_reason, ${SLOT_COLS}
         FROM rota_assignments a
         JOIN departments d ON d.id = a.department_id
         JOIN service_slots ss ON ss.id = a.service_slot_id
         ${SLOT_JOINS}
         LEFT JOIN rota_cover_requests c ON c.assignment_id = a.id AND c.status = 'OPEN'
         WHERE a.member_id = $1 AND ss.start_time > $2 AND ss.start_time <= $3
         ORDER BY ss.start_time`,
        [memberId, now, until],
      ) as Promise<
        (SlotRow & {
          assignment_id: string;
          role: string | null;
          department_id: string;
          department_name: string;
          cover_id: string | null;
          cover_reason: string | null;
        })[]
      >,
      this.assignmentRepo.query(
        `SELECT c.id, c.reason, (c.target_member_id = $1) AS for_me, a.role, d.id AS department_id, d.name AS department_name,
           ${NAME_SQL('rq')} AS requester, ${SLOT_COLS}
         FROM rota_cover_requests c
         JOIN rota_assignments a ON a.id = c.assignment_id
         JOIN departments d ON d.id = c.department_id
         LEFT JOIN members rq ON rq.id = c.requested_by_id
         JOIN service_slots ss ON ss.id = a.service_slot_id
         ${SLOT_JOINS}
         WHERE c.status = 'OPEN' AND ss.start_time > $2
           AND c.department_id IN (
             SELECT wp.department_id FROM worker_profiles wp WHERE wp.member_id = $1 AND wp.status = 'ACTIVE'
             UNION SELECT wp.secondary_department_id FROM worker_profiles wp WHERE wp.member_id = $1 AND wp.status = 'ACTIVE')
           AND a.member_id <> $1
           AND (c.target_member_id IS NULL OR c.target_member_id = $1)
           AND NOT EXISTS (SELECT 1 FROM rota_assignments o WHERE o.service_slot_id = a.service_slot_id AND o.department_id = a.department_id AND o.member_id = $1)
         ORDER BY ss.start_time`,
        [memberId, now],
      ) as Promise<
        (SlotRow & {
          id: string;
          reason: string | null;
          for_me: boolean;
          role: string | null;
          department_id: string;
          department_name: string;
          requester: string | null;
        })[]
      >,
    ]);
    return {
      duties: duties.map((d) => ({
        assignmentId: d.assignment_id,
        role: d.role,
        department: { id: d.department_id, name: d.department_name },
        service: this.slot(d),
        openCover: d.cover_id
          ? { id: d.cover_id, reason: d.cover_reason }
          : null,
      })),
      coverRequests: requests.map((r) => ({
        id: r.id,
        reason: r.reason,
        forMe: !!r.for_me,
        role: r.role,
        requester: r.requester ?? 'A teammate',
        department: { id: r.department_id, name: r.department_name },
        service: this.slot(r),
      })),
    };
  }

  async requestCover(
    memberId: string,
    assignmentId: string,
    dto: RequestCoverDto,
    now = new Date(),
  ) {
    const assignment = await this.assignmentRow(assignmentId);
    if (assignment.member_id !== memberId)
      throw new ForbiddenException('You can only ask cover for your own duty.');
    if (new Date(assignment.start_time) <= now)
      throw new BadRequestException('This service has already started.');
    const open = await this.coverRepo.exists({
      where: { assignment: { id: assignmentId }, status: CoverStatusEnum.OPEN },
    });
    if (open)
      throw new ConflictException("You've already asked for cover for this.");
    if (dto.targetMemberId) {
      if (dto.targetMemberId === memberId)
        throw new BadRequestException('Pick a teammate.');
      const ok = await this.isTeamWorker(
        dto.targetMemberId,
        assignment.department_id,
      );
      if (!ok)
        throw new BadRequestException('Pick someone in this department.');
    }
    const request = await this.coverRepo.save(
      this.coverRepo.create({
        assignment: { id: assignmentId } as RotaAssignment,
        department: { id: assignment.department_id } as never,
        requestedBy: { id: memberId } as never,
        targetMember: dto.targetMemberId
          ? ({ id: dto.targetMemberId } as never)
          : null,
        reason: dto.reason?.trim().slice(0, 300) || null,
      }),
    );
    // Asked of one person, or of everyone in the department who isn't already serving then.
    const recipients = dto.targetMemberId
      ? [dto.targetMemberId]
      : (
          (await this.assignmentRepo.query(
            `SELECT wp.member_id FROM worker_profiles wp JOIN members m ON m.id = wp.member_id
           WHERE wp.status = 'ACTIVE' AND m.status = 'ACTIVE' AND (wp.department_id = $1 OR wp.secondary_department_id = $1)
             AND wp.member_id <> $2
             AND NOT EXISTS (SELECT 1 FROM rota_assignments o WHERE o.service_slot_id = $3 AND o.department_id = $1 AND o.member_id = wp.member_id)`,
            [assignment.department_id, memberId, assignment.slot_id],
          )) as { member_id: string }[]
        ).map((r) => r.member_id);
    const timezone = await this.churchTimezone.get();
    this.push(
      recipients,
      PushNotificationKey.ROTA_COVER_NEEDED,
      {
        requester: assignment.member_name ?? 'A teammate',
        service_name: serviceName(assignment),
        when: this.dateService.format(
          new Date(assignment.start_time),
          'EEE d MMM, h:mm a',
          timezone,
        ),
        role: assignment.role ? ` · ${assignment.role}` : '',
      },
      `rota-cover:${request.id}`,
    );
    return { id: request.id, notified: recipients.length };
  }

  async cancelCover(memberId: string, requestId: string, now = new Date()) {
    const request = await this.coverRepo.findOne({
      where: { id: requestId },
      relations: { requestedBy: true, department: true },
    });
    if (!request || request.status !== CoverStatusEnum.OPEN)
      throw new NotFoundException('Cover request not found');
    const own = request.requestedBy?.id === memberId;
    if (!own && (await this.role(memberId, request.department.id)) !== 'leader')
      throw new ForbiddenException(
        'Only the person who asked, or a leader, can cancel this.',
      );
    await this.coverRepo.update(requestId, {
      status: CoverStatusEnum.CANCELLED,
      resolvedAt: now,
    });
    return { ok: true };
  }

  // The first teammate to accept takes the duty. The request row is locked so two people can't both take it.
  async acceptCover(memberId: string, requestId: string, now = new Date()) {
    const manager = this.txHost.tx;
    const request = await manager
      .getRepository(RotaCoverRequest)
      .createQueryBuilder('c')
      .where('c.id = :requestId', { requestId })
      .setLock('pessimistic_write')
      .getOne();
    if (!request) throw new NotFoundException('Cover request not found');
    if (request.status !== CoverStatusEnum.OPEN)
      throw new ConflictException(
        'Someone has already covered this, or it was cancelled.',
      );
    const details = (await manager.query(
      `SELECT c.assignment_id, c.department_id, c.requested_by_id, c.target_member_id, a.role, a.service_slot_id AS slot_id,
         ss.name, ss.start_time, ss.end_time, e.name AS event_name, d.name AS department_name,
         ${NAME_SQL('me')} AS volunteer
       FROM rota_cover_requests c
       JOIN rota_assignments a ON a.id = c.assignment_id
       JOIN service_slots ss ON ss.id = a.service_slot_id
       JOIN events e ON e.id = ss.event_id
       JOIN departments d ON d.id = c.department_id
       JOIN members me ON me.id = $2
       WHERE c.id = $1`,
      [requestId, memberId],
    )) as {
      assignment_id: string;
      department_id: string;
      requested_by_id: string | null;
      target_member_id: string | null;
      role: string | null;
      slot_id: string;
      name: string;
      start_time: Date;
      event_name: string;
      department_name: string;
      volunteer: string | null;
    }[];
    const d = details[0];
    if (new Date(d.start_time) <= now)
      throw new BadRequestException('This service has already started.');
    if (d.requested_by_id === memberId)
      throw new BadRequestException("You can't cover your own duty.");
    if (d.target_member_id && d.target_member_id !== memberId)
      throw new ForbiddenException('This request was sent to someone else.');
    if (!(await this.isTeamWorker(memberId, d.department_id)))
      throw new ForbiddenException(
        'Only workers in this department can cover.',
      );
    const already = (await manager.query(
      `SELECT 1 FROM rota_assignments WHERE service_slot_id = $1 AND department_id = $2 AND member_id = $3`,
      [d.slot_id, d.department_id, memberId],
    )) as unknown[];
    if (already.length)
      throw new ConflictException(
        "You're already on the rota for this service.",
      );

    await manager.query(
      `UPDATE rota_assignments SET member_id = $2, updated_at = now() WHERE id = $1`,
      [d.assignment_id, memberId],
    );
    await manager.query(
      `UPDATE rota_cover_requests SET status = 'ACCEPTED', accepted_by_id = $2, resolved_at = $3, updated_at = now() WHERE id = $1`,
      [requestId, memberId, now],
    );

    const leads = (await manager.query(
      `SELECT lw.member_id FROM department_leads l JOIN worker_profiles lw ON lw.id = l.worker_profile_id WHERE l.department_id = $1`,
      [d.department_id],
    )) as { member_id: string }[];
    const timezone = await this.churchTimezone.get();
    const recipients = [
      ...new Set([d.requested_by_id, ...leads.map((l) => l.member_id)]),
    ].filter((id): id is string => !!id && id !== memberId);
    this.push(
      recipients,
      PushNotificationKey.ROTA_COVER_TAKEN,
      {
        volunteer: d.volunteer ?? 'A teammate',
        service_name: serviceName(d),
        when: this.dateService.format(
          new Date(d.start_time),
          'EEE d MMM, h:mm a',
          timezone,
        ),
        role: d.role ? ` · ${d.role}` : '',
        department_name: d.department_name,
      },
      `rota-cover-taken:${requestId}`,
    );
    this.audit.log('ROTA_COVER_ACCEPTED', {
      actorId: memberId,
      targetId: d.requested_by_id ?? undefined,
      targetName: `${d.department_name}: ${serviceName(d)}`,
      metadata: { requestId, assignmentId: d.assignment_id },
    });
    return { ok: true };
  }

  private async team(departmentId: string, slotId: string) {
    const rows = (await this.assignmentRepo.query(
      `SELECT m.id, ${NAME_SQL('m')} AS name, m.photo_url,
         (SELECT string_agg(od.name, ', ') FROM rota_assignments o JOIN departments od ON od.id = o.department_id
          WHERE o.service_slot_id = $2 AND o.member_id = m.id AND o.department_id <> $1) AS elsewhere
       FROM worker_profiles wp JOIN members m ON m.id = wp.member_id
       WHERE wp.status = 'ACTIVE' AND m.status = 'ACTIVE' AND (wp.department_id = $1 OR wp.secondary_department_id = $1)
       ORDER BY name`,
      [departmentId, slotId],
    )) as {
      id: string;
      name: string | null;
      photo_url: string | null;
      elsewhere: string | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name ?? 'Member',
      photoUrl: r.photo_url,
      // Already serving with another department at the same service.
      servingElsewhere: r.elsewhere,
    }));
  }

  private async role(
    memberId: string,
    departmentId: string,
  ): Promise<'leader' | 'member'> {
    const rows = (await this.assignmentRepo.query(
      `SELECT
         EXISTS (SELECT 1 FROM department_leads l JOIN worker_profiles lw ON lw.id = l.worker_profile_id
                 WHERE l.department_id = $2 AND lw.member_id = $1) AS is_leader,
         EXISTS (SELECT 1 FROM worker_profiles wp WHERE wp.member_id = $1 AND wp.status = 'ACTIVE'
                 AND (wp.department_id = $2 OR wp.secondary_department_id = $2)) AS is_member`,
      [memberId, departmentId],
    )) as { is_leader: boolean; is_member: boolean }[];
    if (rows[0]?.is_leader) return 'leader';
    if (rows[0]?.is_member) return 'member';
    throw new ForbiddenException("This isn't one of your departments.");
  }

  private async isTeamWorker(
    memberId: string,
    departmentId: string,
  ): Promise<boolean> {
    const rows = (await this.assignmentRepo.query(
      `SELECT 1 FROM worker_profiles wp JOIN members m ON m.id = wp.member_id
       WHERE wp.member_id = $1 AND wp.status = 'ACTIVE' AND m.status = 'ACTIVE'
         AND (wp.department_id = $2 OR wp.secondary_department_id = $2)`,
      [memberId, departmentId],
    )) as unknown[];
    return rows.length > 0;
  }

  private async findSlot(slotId: string): Promise<SlotRow> {
    const rows = (await this.assignmentRepo.query(
      `SELECT ${SLOT_COLS} FROM service_slots ss ${SLOT_JOINS} WHERE ss.id = $1`,
      [slotId],
    )) as SlotRow[];
    if (!rows[0]) throw new NotFoundException('Service not found');
    return rows[0];
  }

  private async assignmentRow(assignmentId: string) {
    const rows = (await this.assignmentRepo.query(
      `SELECT a.id, a.member_id, a.department_id, a.role, a.service_slot_id AS slot_id, ss.name, ss.start_time, e.name AS event_name,
         ${NAME_SQL('m')} AS member_name
       FROM rota_assignments a
       JOIN service_slots ss ON ss.id = a.service_slot_id
       JOIN events e ON e.id = ss.event_id
       JOIN members m ON m.id = a.member_id
       WHERE a.id = $1`,
      [assignmentId],
    )) as {
      id: string;
      member_id: string;
      department_id: string;
      role: string | null;
      slot_id: string;
      name: string;
      start_time: Date;
      event_name: string;
      member_name: string | null;
    }[];
    if (!rows[0]) throw new NotFoundException('Duty not found');
    return rows[0];
  }

  private async departmentName(departmentId: string): Promise<string> {
    const rows = (await this.assignmentRepo.query(
      `SELECT name FROM departments WHERE id = $1`,
      [departmentId],
    )) as { name: string }[];
    return rows[0]?.name ?? 'your department';
  }

  private slot(r: SlotRow) {
    return {
      id: r.slot_id,
      name: serviceName(r),
      startTime: r.start_time,
      endTime: r.end_time,
      venue: r.venue,
    };
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
