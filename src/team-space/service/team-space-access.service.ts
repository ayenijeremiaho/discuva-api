import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TeamSpace, TeamSpaceKindEnum } from '../entity/team-space.entity';
import {
  ADULT_AGE,
  VOLUNTEER_SPACE_LISTED_DAYS,
  VOLUNTEER_SPACE_OPEN_DAYS,
} from '../constant/team-space.constant';
import { ChurchSettingsService } from '../../church-settings/service/church-settings.service';

export interface SpaceMembership {
  kind: TeamSpaceKindEnum;
  refId: string;
  name: string;
  isLeader: boolean;
  // Volunteering spaces only: when the event is, and whether the space has stopped taking posts.
  eventAt?: Date | null;
  closed?: boolean;
}

const DAY_MS = 24 * 3600 * 1000;

// Leads a volunteering space: the admin who created the opportunity, or a lead of its department.
const VOLUNTEER_LEADER_SQL = `(
  EXISTS (SELECT 1 FROM admins a WHERE a.id = o.created_by_id AND a.member_id = $1)
  OR (o.department_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM department_leads l JOIN worker_profiles lw ON lw.id = l.worker_profile_id
    WHERE l.department_id = o.department_id AND lw.member_id = $1)))`;

export function volunteerSpaceClosed(
  o: { status: string; date: Date },
  now = new Date(),
): boolean {
  return (
    o.status === 'CANCELLED' ||
    new Date(o.date).getTime() + VOLUNTEER_SPACE_OPEN_DAYS * DAY_MS <=
      now.getTime()
  );
}

export interface SpaceAccess extends SpaceMembership {
  space: TeamSpace;
}

// Under 18 only when a birth year is on the profile; without one the age can't be known.
export function isUnder18(
  birth: { year: number | null; month: number | null; day: number | null },
  today = new Date(),
): boolean {
  if (!birth.year) return false;
  let age = today.getUTCFullYear() - birth.year;
  const month = birth.month ?? 1;
  const day = birth.day ?? 1;
  if (
    today.getUTCMonth() + 1 < month ||
    (today.getUTCMonth() + 1 === month && today.getUTCDate() < day)
  )
    age -= 1;
  return age < ADULT_AGE;
}

// Who belongs to which space comes straight from the department roster or the fellowship's members, so it never drifts.
@Injectable()
export class TeamSpaceAccessService {
  constructor(
    @InjectRepository(TeamSpace)
    private readonly spaceRepo: Repository<TeamSpace>,
    private readonly churchSettings: ChurchSettingsService,
  ) {}

  async memberships(
    memberId: string,
    now = new Date(),
  ): Promise<SpaceMembership[]> {
    const [departments, fellowships, volunteering] = await Promise.all([
      this.spaceRepo.query(
        `SELECT d.id, d.name,
           EXISTS (SELECT 1 FROM department_leads l JOIN worker_profiles lw ON lw.id = l.worker_profile_id
                   WHERE l.department_id = d.id AND lw.member_id = $1) AS is_leader
         FROM departments d
         WHERE d.id IN (
           SELECT wp.department_id FROM worker_profiles wp WHERE wp.member_id = $1 AND wp.status = 'ACTIVE'
           UNION SELECT wp.secondary_department_id FROM worker_profiles wp WHERE wp.member_id = $1 AND wp.status = 'ACTIVE'
           UNION SELECT l.department_id FROM department_leads l JOIN worker_profiles lw ON lw.id = l.worker_profile_id WHERE lw.member_id = $1
         )`,
        [memberId],
      ) as Promise<{ id: string; name: string; is_leader: boolean }[]>,
      this.spaceRepo.query(
        `SELECT g.id, g.name, (g.leader_id = $1) AS is_leader
         FROM small_groups g
         WHERE g.id IN (
           SELECT m.group_id FROM small_group_members m WHERE m.member_id = $1
           UNION SELECT lg.id FROM small_groups lg WHERE lg.leader_id = $1
         )`,
        [memberId],
      ) as Promise<{ id: string; name: string; is_leader: boolean }[]>,
      this.volunteerMemberships(memberId, now),
    ]);
    return [
      ...departments.map((d) => ({
        kind: TeamSpaceKindEnum.DEPARTMENT,
        refId: d.id,
        name: d.name,
        isLeader: d.is_leader,
      })),
      ...fellowships.map((g) => ({
        kind: TeamSpaceKindEnum.FELLOWSHIP,
        refId: g.id,
        name: g.name,
        isLeader: !!g.is_leader,
      })),
      ...volunteering,
    ];
  }

  // Opportunities the member signed up for or leads, from a little before the event until two weeks after.
  private async volunteerMemberships(
    memberId: string,
    now: Date,
  ): Promise<SpaceMembership[]> {
    if (!(await this.churchSettings.isEnabled('volunteering'))) return [];
    const rows = (await this.spaceRepo.query(
      `SELECT o.id, o.title, o.date, o.status, ${VOLUNTEER_LEADER_SQL} AS is_leader
       FROM volunteer_opportunities o
       WHERE o.date > $2 AND o.status <> 'CANCELLED'
         AND o.id IN (
           SELECT s.opportunity_id FROM volunteer_signups s WHERE s.member_id = $1 AND s.status = 'CONFIRMED'
           UNION SELECT o2.id FROM volunteer_opportunities o2 JOIN admins a ON a.id = o2.created_by_id WHERE a.member_id = $1
           UNION SELECT o3.id FROM volunteer_opportunities o3
             WHERE o3.department_id IN (
               SELECT l.department_id FROM department_leads l JOIN worker_profiles lw ON lw.id = l.worker_profile_id
               WHERE lw.member_id = $1)
         )`,
      [
        memberId,
        new Date(now.getTime() - VOLUNTEER_SPACE_LISTED_DAYS * DAY_MS),
      ],
    )) as {
      id: string;
      title: string;
      date: Date;
      status: string;
      is_leader: boolean;
    }[];
    return rows.map((o) => ({
      kind: TeamSpaceKindEnum.VOLUNTEERING,
      refId: o.id,
      name: o.title,
      isLeader: !!o.is_leader,
      eventAt: o.date,
      closed: volunteerSpaceClosed(o, now),
    }));
  }

  // The member's place in one space, creating the space row the first time anyone opens it.
  async access(
    memberId: string,
    kind: TeamSpaceKindEnum,
    refId: string,
  ): Promise<SpaceAccess> {
    if (kind === TeamSpaceKindEnum.VOLUNTEERING)
      return this.volunteerAccess(memberId, refId);
    const rows = (await (kind === TeamSpaceKindEnum.DEPARTMENT
      ? this.spaceRepo.query(
          `SELECT d.name,
             EXISTS (SELECT 1 FROM department_leads l JOIN worker_profiles lw ON lw.id = l.worker_profile_id
                     WHERE l.department_id = d.id AND lw.member_id = $1) AS is_leader,
             EXISTS (SELECT 1 FROM worker_profiles wp WHERE wp.member_id = $1 AND wp.status = 'ACTIVE'
                     AND (wp.department_id = d.id OR wp.secondary_department_id = d.id)) AS is_member
           FROM departments d WHERE d.id = $2`,
          [memberId, refId],
        )
      : this.spaceRepo.query(
          `SELECT g.name, (g.leader_id = $1) AS is_leader,
             EXISTS (SELECT 1 FROM small_group_members m WHERE m.group_id = g.id AND m.member_id = $1) AS is_member
           FROM small_groups g WHERE g.id = $2`,
          [memberId, refId],
        ))) as { name: string; is_leader: boolean; is_member: boolean }[];
    const row = rows[0];
    if (!row) throw new NotFoundException('Team not found');
    if (!row.is_leader && !row.is_member)
      throw new ForbiddenException("This isn't one of your teams.");
    return {
      kind,
      refId,
      name: row.name,
      isLeader: !!row.is_leader,
      space: await this.ensureSpace(kind, refId),
    };
  }

  private async volunteerAccess(
    memberId: string,
    refId: string,
    now = new Date(),
  ): Promise<SpaceAccess> {
    if (!(await this.churchSettings.isEnabled('volunteering')))
      throw new NotFoundException('Team not found');
    const rows = (await this.spaceRepo.query(
      `SELECT o.title, o.date, o.status, ${VOLUNTEER_LEADER_SQL} AS is_leader,
         EXISTS (SELECT 1 FROM volunteer_signups s
                 WHERE s.opportunity_id = o.id AND s.member_id = $1 AND s.status = 'CONFIRMED') AS is_member
       FROM volunteer_opportunities o WHERE o.id = $2`,
      [memberId, refId],
    )) as {
      title: string;
      date: Date;
      status: string;
      is_leader: boolean;
      is_member: boolean;
    }[];
    const row = rows[0];
    if (!row) throw new NotFoundException('Team not found');
    if (!row.is_leader && !row.is_member)
      throw new ForbiddenException(
        "You're not signed up for this. Sign up to join the conversation.",
      );
    return {
      kind: TeamSpaceKindEnum.VOLUNTEERING,
      refId,
      name: row.title,
      isLeader: !!row.is_leader,
      eventAt: row.date,
      closed: volunteerSpaceClosed(row, now),
      space: await this.ensureSpace(TeamSpaceKindEnum.VOLUNTEERING, refId),
    };
  }

  // Volunteering spaces stop taking posts, replies and votes a few days after the event.
  assertOpen(acc: SpaceMembership) {
    if (acc.closed)
      throw new ForbiddenException(
        'This space closed after the event. You can still read it.',
      );
  }

  async accessBySpace(
    memberId: string,
    space: TeamSpace,
  ): Promise<SpaceAccess> {
    return this.access(memberId, space.kind, space.refId);
  }

  async ensureSpace(
    kind: TeamSpaceKindEnum,
    refId: string,
  ): Promise<TeamSpace> {
    const existing = await this.spaceRepo.findOne({ where: { kind, refId } });
    if (existing) return existing;
    await this.spaceRepo
      .createQueryBuilder()
      .insert()
      .into(TeamSpace)
      .values({ kind, refId })
      .orIgnore()
      .execute();
    return this.spaceRepo.findOneOrFail({ where: { kind, refId } });
  }

  // Everyone a space reaches: the active roster plus its leaders.
  async memberIds(space: Pick<TeamSpace, 'kind' | 'refId'>): Promise<string[]> {
    if (space.kind === TeamSpaceKindEnum.VOLUNTEERING) {
      const rows = (await this.spaceRepo.query(
        `SELECT m.id FROM members m
         WHERE m.status = 'ACTIVE' AND m.id IN (
           SELECT s.member_id FROM volunteer_signups s WHERE s.opportunity_id = $1 AND s.status = 'CONFIRMED'
           UNION SELECT a.member_id FROM volunteer_opportunities o JOIN admins a ON a.id = o.created_by_id WHERE o.id = $1
           UNION SELECT lw.member_id FROM volunteer_opportunities o
             JOIN department_leads l ON l.department_id = o.department_id
             JOIN worker_profiles lw ON lw.id = l.worker_profile_id WHERE o.id = $1
         )`,
        [space.refId],
      )) as { id: string }[];
      return rows.map((r) => r.id);
    }
    const rows = (await (space.kind === TeamSpaceKindEnum.DEPARTMENT
      ? this.spaceRepo.query(
          `SELECT m.id FROM members m
           WHERE m.status = 'ACTIVE' AND m.id IN (
             SELECT wp.member_id FROM worker_profiles wp
             WHERE wp.status = 'ACTIVE' AND (wp.department_id = $1 OR wp.secondary_department_id = $1)
             UNION SELECT lw.member_id FROM department_leads l JOIN worker_profiles lw ON lw.id = l.worker_profile_id
             WHERE l.department_id = $1
           )`,
          [space.refId],
        )
      : this.spaceRepo.query(
          `SELECT m.id FROM members m
           WHERE m.status = 'ACTIVE' AND m.id IN (
             SELECT sm.member_id FROM small_group_members sm WHERE sm.group_id = $1
             UNION SELECT g.leader_id FROM small_groups g WHERE g.id = $1 AND g.leader_id IS NOT NULL
           )`,
          [space.refId],
        ))) as { id: string }[];
    return rows.map((r) => r.id);
  }

  async isMinor(memberId: string): Promise<boolean> {
    const rows = (await this.spaceRepo.query(
      `SELECT birth_year AS year, birth_month AS month, birth_day AS day FROM members WHERE id = $1`,
      [memberId],
    )) as { year: number | null; month: number | null; day: number | null }[];
    return rows[0] ? isUnder18(rows[0]) : false;
  }
}
