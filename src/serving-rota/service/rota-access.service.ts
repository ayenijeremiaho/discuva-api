import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RotaAssignment } from '../entity/rota-assignment.entity';

export interface RotaEntry {
  memberId: string;
  role?: string | null;
}

export interface RotaAccess {
  isLeader: boolean;
  isMember: boolean;
  canPlan: boolean;
  canPublish: boolean;
  // null means the whole department; otherwise only these responsibilities.
  planRoles: string[] | null;
  publishRoles: string[] | null;
}

export type RotaTarget =
  { slotId: string } | { scheduleId: string; date: string };

const sameRole = (roles: string[], role?: string | null) =>
  !!role && roles.includes(role);

@Injectable()
export class RotaAccessService {
  constructor(
    @InjectRepository(RotaAssignment)
    private readonly repo: Repository<RotaAssignment>,
  ) {}

  async of(memberId: string, departmentId: string): Promise<RotaAccess> {
    const rows = (await this.repo.query(
      `SELECT
         EXISTS (SELECT 1 FROM department_leads l JOIN worker_profiles lw ON lw.id = l.worker_profile_id
                 WHERE l.department_id = $2 AND lw.member_id = $1) AS is_leader,
         EXISTS (SELECT 1 FROM worker_profiles wp WHERE wp.member_id = $1 AND wp.status = 'ACTIVE'
                 AND (wp.department_id = $2 OR wp.secondary_department_id = $2)) AS is_member,
         COALESCE((SELECT json_agg(json_build_object('subteam', p.subteam_id, 'publish', p.can_publish,
                     'roles', (SELECT COALESCE(json_agg(r.name), '[]') FROM rota_responsibilities r WHERE r.subteam_id = p.subteam_id)))
                   FROM rota_planner_grants p WHERE p.department_id = $2 AND p.member_id = $1), '[]') AS grants`,
      [memberId, departmentId],
    )) as {
      is_leader: boolean;
      is_member: boolean;
      grants: { subteam: string | null; publish: boolean; roles: string[] }[];
    }[];
    const row = rows[0];
    const grants = row?.grants ?? [];
    const whole = grants.find((g) => !g.subteam);
    const planAll = !!row?.is_leader || !!whole;
    const publishAll = !!row?.is_leader || !!whole?.publish;
    const scoped = grants.filter((g) => g.subteam);
    const planRoles = planAll ? null : scoped.flatMap((g) => g.roles);
    const publishRoles = publishAll
      ? null
      : scoped.filter((g) => g.publish).flatMap((g) => g.roles);
    return {
      isLeader: !!row?.is_leader,
      isMember: !!row?.is_member,
      canPlan: planAll || scoped.length > 0,
      canPublish: publishAll || scoped.some((g) => g.publish),
      planRoles,
      publishRoles,
    };
  }

  // Someone with a limited scope only changes their own responsibilities; everything else stays as it was.
  merge(
    roles: string[] | null,
    current: RotaEntry[],
    incoming: RotaEntry[],
  ): RotaEntry[] {
    if (!roles) return incoming;
    if (incoming.some((entry) => !sameRole(roles, entry.role)))
      throw new BadRequestException(
        'You can only plan the responsibilities in your own group.',
      );
    return [
      ...current.filter((entry) => !sameRole(roles, entry.role)),
      ...incoming,
    ];
  }

  // Applied entries from a scoped draft: leave what's outside the scope alone, as published.
  scopeOf(roles: string[] | null, entries: RotaEntry[]): RotaEntry[] {
    return roles
      ? entries.filter((entry) => sameRole(roles, entry.role))
      : entries;
  }

  async draft(
    departmentId: string,
    target: RotaTarget,
  ): Promise<{
    id: string;
    entries: RotaEntry[];
    updatedAt: Date;
    updatedBy: string | null;
  } | null> {
    const rows = (await this.repo.query(
      `SELECT dr.id, dr.entries, dr.updated_at,
         NULLIF(TRIM(COALESCE(m.firstname, '') || ' ' || COALESCE(m.lastname, '')), '') AS updated_by
       FROM rota_drafts dr LEFT JOIN members m ON m.id = dr.updated_by_id
       WHERE dr.department_id = $1 AND ${
         'slotId' in target
           ? 'dr.service_slot_id = $2'
           : 'dr.schedule_id = $2 AND dr.occurrence_date = $3::date'
       }`,
      'slotId' in target
        ? [departmentId, target.slotId]
        : [departmentId, target.scheduleId, target.date],
    )) as {
      id: string;
      entries: RotaEntry[];
      updated_at: Date;
      updated_by: string | null;
    }[];
    const row = rows[0];
    return row
      ? {
          id: row.id,
          entries: row.entries,
          updatedAt: row.updated_at,
          updatedBy: row.updated_by,
        }
      : null;
  }

  async draftKeys(departmentId: string): Promise<Set<string>> {
    const rows = (await this.repo.query(
      `SELECT service_slot_id, schedule_id, occurrence_date::text AS occurrence_date
       FROM rota_drafts WHERE department_id = $1`,
      [departmentId],
    )) as {
      service_slot_id: string | null;
      schedule_id: string | null;
      occurrence_date: string | null;
    }[];
    return new Set(
      rows.map(
        (r) => r.service_slot_id ?? `${r.schedule_id}:${r.occurrence_date}`,
      ),
    );
  }

  async clearDraft(departmentId: string, target: RotaTarget): Promise<void> {
    await this.repo.query(
      `DELETE FROM rota_drafts WHERE department_id = $1 AND ${
        'slotId' in target
          ? 'service_slot_id = $2'
          : 'schedule_id = $2 AND occurrence_date = $3::date'
      }`,
      'slotId' in target
        ? [departmentId, target.slotId]
        : [departmentId, target.scheduleId, target.date],
    );
  }
}
