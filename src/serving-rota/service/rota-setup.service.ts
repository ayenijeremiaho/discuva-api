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
import { RotaSubteam } from '../entity/rota-subteam.entity';
import { RotaResponsibility } from '../entity/rota-responsibility.entity';
import { RotaResponsibilityMember } from '../entity/rota-responsibility-member.entity';
import { RotaPlannerGrant } from '../entity/rota-planner-grant.entity';
import { RotaSchedule } from '../entity/rota-schedule.entity';
import {
  RotaPlannerEntryDto,
  SaveRotaEligibilityDto,
  SaveRotaResponsibilityDto,
  SaveRotaScheduleDto,
  SaveRotaSubteamDto,
} from '../dto/rota-setup.dto';
import { Department } from '../../department/entity/department.entity';
import { Member } from '../../member/entity/member.entity';
import { RotaScheduleType } from '../enum/rota-allocation-mode.enum';
import {
  AuditAction,
  AuditLogService,
} from '../../utility/service/audit-log.service';

const NAME_SQL = `NULLIF(TRIM(COALESCE(m.firstname, '') || ' ' || COALESCE(m.lastname, '')), '')`;

@Injectable()
export class RotaSetupService {
  constructor(
    @InjectRepository(RotaSubteam)
    private readonly subteams: Repository<RotaSubteam>,
    @InjectRepository(RotaResponsibility)
    private readonly responsibilities: Repository<RotaResponsibility>,
    @InjectRepository(RotaResponsibilityMember)
    private readonly eligibility: Repository<RotaResponsibilityMember>,
    @InjectRepository(RotaPlannerGrant)
    private readonly planners: Repository<RotaPlannerGrant>,
    @InjectRepository(RotaSchedule)
    private readonly schedules: Repository<RotaSchedule>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly audit: AuditLogService,
  ) {}

  async get(memberId: string, departmentId: string) {
    const access = await this.access(memberId, departmentId);
    const [subteams, responsibilities, eligible, planners, schedules, team] =
      await Promise.all([
        this.subteams.find({
          where: { department: { id: departmentId } },
          order: { position: 'ASC', name: 'ASC' },
        }),
        this.responsibilities.find({
          where: { department: { id: departmentId } },
          relations: { subteam: true },
          order: { position: 'ASC', name: 'ASC' },
        }),
        this.eligibility.query(
          `SELECT rm.responsibility_id, rm.member_id, rm.is_fixed, ${NAME_SQL} AS name
           FROM rota_responsibility_members rm
           JOIN rota_responsibilities r ON r.id = rm.responsibility_id
           JOIN members m ON m.id = rm.member_id
           WHERE r.department_id = $1
           ORDER BY name`,
          [departmentId],
        ) as Promise<
          {
            responsibility_id: string;
            member_id: string;
            is_fixed: boolean;
            name: string | null;
          }[]
        >,
        access.isLeader
          ? (this.planners.query(
              `SELECT p.id, p.member_id, p.subteam_id, p.can_publish, ${NAME_SQL} AS name
               FROM rota_planner_grants p JOIN members m ON m.id = p.member_id
               WHERE p.department_id = $1 ORDER BY name`,
              [departmentId],
            ) as Promise<
              {
                id: string;
                member_id: string;
                subteam_id: string | null;
                can_publish: boolean;
                name: string | null;
              }[]
            >)
          : Promise.resolve([]),
        this.schedules.find({
          where: { department: { id: departmentId } },
          order: { position: 'ASC', name: 'ASC' },
        }),
        access.isLeader
          ? (this.subteams.query(
              `SELECT DISTINCT m.id, ${NAME_SQL} AS name, m.photo_url
               FROM worker_profiles wp JOIN members m ON m.id = wp.member_id
               WHERE wp.status = 'ACTIVE' AND m.status = 'ACTIVE'
                 AND (wp.department_id = $1 OR wp.secondary_department_id = $1)
               ORDER BY name`,
              [departmentId],
            ) as Promise<
              { id: string; name: string | null; photo_url: string | null }[]
            >)
          : Promise.resolve([]),
      ]);
    const byResponsibility = new Map<string, typeof eligible>();
    for (const row of eligible)
      byResponsibility.set(row.responsibility_id, [
        ...(byResponsibility.get(row.responsibility_id) ?? []),
        row,
      ]);
    return {
      access,
      schedules,
      subteams,
      team: team.map((m) => ({
        id: m.id,
        name: m.name ?? 'Member',
        photoUrl: m.photo_url,
      })),
      responsibilities: responsibilities.map((r) => ({
        ...r,
        eligibleMembers: (byResponsibility.get(r.id) ?? []).map((m) => ({
          id: m.member_id,
          name: m.name ?? 'Member',
          isFixed: m.is_fixed,
        })),
      })),
      planners: planners.map((p) => ({
        id: p.id,
        member: { id: p.member_id, name: p.name ?? 'Member' },
        subteamId: p.subteam_id,
        canPublish: p.can_publish,
      })),
    };
  }

  async createSubteam(
    actorId: string,
    departmentId: string,
    dto: SaveRotaSubteamDto,
  ) {
    await this.assertLeader(actorId, departmentId);
    const row = await this.subteams.save(
      this.subteams.create({
        department: { id: departmentId } as Department,
        name: dto.name.trim(),
        position: dto.position ?? 0,
      }),
    );
    this.log('ROTA_SUBTEAM_CREATED', actorId, row.id, row.name, departmentId);
    return row;
  }

  async updateSubteam(
    actorId: string,
    departmentId: string,
    id: string,
    dto: SaveRotaSubteamDto,
  ) {
    await this.assertLeader(actorId, departmentId);
    const row = await this.subteam(id, departmentId);
    row.name = dto.name.trim();
    row.position = dto.position ?? row.position;
    const saved = await this.subteams.save(row);
    this.log('ROTA_SUBTEAM_UPDATED', actorId, id, saved.name, departmentId);
    return saved;
  }

  async deleteSubteam(actorId: string, departmentId: string, id: string) {
    await this.assertLeader(actorId, departmentId);
    const row = await this.subteam(id, departmentId);
    await this.subteams.remove(row);
    this.log('ROTA_SUBTEAM_DELETED', actorId, id, row.name, departmentId);
    return { ok: true };
  }

  async createResponsibility(
    actorId: string,
    departmentId: string,
    dto: SaveRotaResponsibilityDto,
  ) {
    await this.assertLeader(actorId, departmentId);
    await this.assertSubteam(dto.subteamId, departmentId);
    const row = await this.responsibilities.save(
      this.responsibilities.create({
        department: { id: departmentId } as Department,
        subteam: dto.subteamId ? ({ id: dto.subteamId } as RotaSubteam) : null,
        name: dto.name.trim(),
        requiredCount: dto.requiredCount,
        allocationMode: dto.allocationMode,
        position: dto.position ?? 0,
      }),
    );
    this.log(
      'ROTA_RESPONSIBILITY_CREATED',
      actorId,
      row.id,
      row.name,
      departmentId,
    );
    return row;
  }

  async updateResponsibility(
    actorId: string,
    departmentId: string,
    id: string,
    dto: SaveRotaResponsibilityDto,
  ) {
    await this.assertLeader(actorId, departmentId);
    await this.assertSubteam(dto.subteamId, departmentId);
    const row = await this.responsibility(id, departmentId);
    Object.assign(row, {
      name: dto.name.trim(),
      subteam: dto.subteamId ? ({ id: dto.subteamId } as RotaSubteam) : null,
      requiredCount: dto.requiredCount,
      allocationMode: dto.allocationMode,
      position: dto.position ?? row.position,
    });
    const saved = await this.responsibilities.save(row);
    this.log(
      'ROTA_RESPONSIBILITY_UPDATED',
      actorId,
      id,
      saved.name,
      departmentId,
    );
    return saved;
  }

  async deleteResponsibility(
    actorId: string,
    departmentId: string,
    id: string,
  ) {
    await this.assertLeader(actorId, departmentId);
    const row = await this.responsibility(id, departmentId);
    await this.responsibilities.remove(row);
    this.log(
      'ROTA_RESPONSIBILITY_DELETED',
      actorId,
      id,
      row.name,
      departmentId,
    );
    return { ok: true };
  }

  async saveEligibility(
    actorId: string,
    departmentId: string,
    responsibilityId: string,
    dto: SaveRotaEligibilityDto,
  ) {
    await this.assertLeader(actorId, departmentId);
    await this.responsibility(responsibilityId, departmentId);
    const ids = [...new Set(dto.members.map((m) => m.memberId))];
    if (ids.length !== dto.members.length)
      throw new BadRequestException('Each person can only be added once.');
    await this.assertTeamMembers(ids, departmentId);
    const manager = this.txHost.tx;
    await manager.query(
      `DELETE FROM rota_responsibility_members WHERE responsibility_id = $1`,
      [responsibilityId],
    );
    if (dto.members.length)
      await manager.query(
        `INSERT INTO rota_responsibility_members (responsibility_id, member_id, is_fixed)
         SELECT $1, x.member_id, x.is_fixed
         FROM unnest($2::uuid[], $3::boolean[]) AS x(member_id, is_fixed)`,
        [
          responsibilityId,
          dto.members.map((m) => m.memberId),
          dto.members.map((m) => m.isFixed ?? false),
        ],
      );
    this.log(
      'ROTA_ELIGIBILITY_UPDATED',
      actorId,
      responsibilityId,
      'Responsibility eligibility',
      departmentId,
    );
    return { count: dto.members.length };
  }

  async savePlanners(
    actorId: string,
    departmentId: string,
    entries: RotaPlannerEntryDto[],
  ) {
    await this.assertLeader(actorId, departmentId);
    await this.assertTeamMembers(
      [...new Set(entries.map((p) => p.memberId))],
      departmentId,
    );
    const subteamIds = [
      ...new Set(entries.map((p) => p.subteamId).filter(Boolean)),
    ] as string[];
    await Promise.all(subteamIds.map((id) => this.subteam(id, departmentId)));
    const keys = entries.map((p) => `${p.memberId}:${p.subteamId ?? ''}`);
    if (new Set(keys).size !== keys.length)
      throw new BadRequestException(
        'Each planner scope can only be added once.',
      );
    const manager = this.txHost.tx;
    await manager.query(
      `DELETE FROM rota_planner_grants WHERE department_id = $1`,
      [departmentId],
    );
    if (entries.length)
      await manager.query(
        `INSERT INTO rota_planner_grants (department_id, member_id, subteam_id, can_publish)
         SELECT $1, x.member_id, x.subteam_id, x.can_publish
         FROM unnest($2::uuid[], $3::uuid[], $4::boolean[]) AS x(member_id, subteam_id, can_publish)`,
        [
          departmentId,
          entries.map((p) => p.memberId),
          entries.map((p) => p.subteamId ?? null),
          entries.map((p) => p.canPublish),
        ],
      );
    this.log(
      'ROTA_PLANNERS_UPDATED',
      actorId,
      departmentId,
      'Rota planners',
      departmentId,
    );
    return { count: entries.length };
  }

  async createSchedule(
    actorId: string,
    departmentId: string,
    dto: SaveRotaScheduleDto,
  ) {
    await this.assertLeader(actorId, departmentId);
    this.assertSchedule(dto);
    const row = await this.schedules.save(
      this.schedules.create(this.scheduleValues(departmentId, dto)),
    );
    this.log('ROTA_SCHEDULE_CREATED', actorId, row.id, row.name, departmentId);
    return row;
  }

  async updateSchedule(
    actorId: string,
    departmentId: string,
    id: string,
    dto: SaveRotaScheduleDto,
  ) {
    await this.assertLeader(actorId, departmentId);
    this.assertSchedule(dto);
    const row = await this.schedule(id, departmentId);
    Object.assign(row, this.scheduleValues(departmentId, dto));
    const saved = await this.schedules.save(row);
    this.log('ROTA_SCHEDULE_UPDATED', actorId, id, saved.name, departmentId);
    return saved;
  }

  async deleteSchedule(actorId: string, departmentId: string, id: string) {
    await this.assertLeader(actorId, departmentId);
    const row = await this.schedule(id, departmentId);
    await this.schedules.remove(row);
    this.log('ROTA_SCHEDULE_DELETED', actorId, id, row.name, departmentId);
    return { ok: true };
  }

  private scheduleValues(departmentId: string, dto: SaveRotaScheduleDto) {
    const custom = dto.scheduleType === RotaScheduleType.CUSTOM;
    return {
      department: { id: departmentId } as Department,
      name: dto.name.trim(),
      scheduleType: dto.scheduleType,
      allocationMode: dto.allocationMode,
      dayOfWeek: custom ? (dto.dayOfWeek ?? null) : null,
      startTime: custom ? (dto.startTime ?? null) : null,
      endTime: custom ? (dto.endTime ?? null) : null,
      active: dto.active ?? true,
      position: dto.position ?? 0,
    };
  }

  private assertSchedule(dto: SaveRotaScheduleDto) {
    if (dto.scheduleType !== RotaScheduleType.CUSTOM) return;
    if (
      dto.dayOfWeek === undefined ||
      !dto.startTime ||
      !dto.endTime ||
      dto.endTime <= dto.startTime
    )
      throw new BadRequestException(
        'An independent schedule needs a weekday and an end time after its start time.',
      );
  }

  private async access(memberId: string, departmentId: string) {
    const rows = (await this.subteams.query(
      `SELECT
         EXISTS (SELECT 1 FROM department_leads l JOIN worker_profiles lw ON lw.id = l.worker_profile_id
                 WHERE l.department_id = $2 AND lw.member_id = $1) AS is_leader,
         EXISTS (SELECT 1 FROM worker_profiles wp WHERE wp.member_id = $1 AND wp.status = 'ACTIVE'
                 AND (wp.department_id = $2 OR wp.secondary_department_id = $2)) AS is_member,
         EXISTS (SELECT 1 FROM rota_planner_grants p WHERE p.department_id = $2 AND p.member_id = $1) AS is_planner,
         EXISTS (SELECT 1 FROM rota_planner_grants p WHERE p.department_id = $2 AND p.member_id = $1 AND p.can_publish) AS can_publish`,
      [memberId, departmentId],
    )) as {
      is_leader: boolean;
      is_member: boolean;
      is_planner: boolean;
      can_publish: boolean;
    }[];
    const row = rows[0];
    if (!row?.is_leader && !row?.is_member && !row?.is_planner)
      throw new ForbiddenException("This isn't one of your departments.");
    return {
      isLeader: !!row.is_leader,
      canPlan: !!row.is_leader || !!row.is_planner,
      canPublish: !!row.is_leader || !!row.can_publish,
    };
  }

  private async assertLeader(memberId: string, departmentId: string) {
    if (!(await this.access(memberId, departmentId)).isLeader)
      throw new ForbiddenException(
        "Only the department's HOD or Deputy HOD can change rota setup.",
      );
  }

  private async assertTeamMembers(ids: string[], departmentId: string) {
    if (!ids.length) return;
    const rows = (await this.subteams.query(
      `SELECT DISTINCT wp.member_id FROM worker_profiles wp JOIN members m ON m.id = wp.member_id
       WHERE wp.member_id = ANY($1) AND wp.status = 'ACTIVE' AND m.status = 'ACTIVE'
         AND (wp.department_id = $2 OR wp.secondary_department_id = $2)`,
      [ids, departmentId],
    )) as { member_id: string }[];
    if (rows.length !== ids.length)
      throw new BadRequestException(
        'Every selected person must be an active worker in this department.',
      );
  }

  private async assertSubteam(
    id: string | null | undefined,
    departmentId: string,
  ) {
    if (id) await this.subteam(id, departmentId);
  }

  private async subteam(id: string, departmentId: string) {
    const row = await this.subteams.findOne({
      where: { id, department: { id: departmentId } },
    });
    if (!row) throw new NotFoundException('Rota subteam not found.');
    return row;
  }

  private async responsibility(id: string, departmentId: string) {
    const row = await this.responsibilities.findOne({
      where: { id, department: { id: departmentId } },
    });
    if (!row) throw new NotFoundException('Rota responsibility not found.');
    return row;
  }

  private async schedule(id: string, departmentId: string) {
    const row = await this.schedules.findOne({
      where: { id, department: { id: departmentId } },
    });
    if (!row) throw new NotFoundException('Rota schedule not found.');
    return row;
  }

  private log(
    action: AuditAction,
    actorId: string,
    targetId: string,
    targetName: string,
    departmentId: string,
  ) {
    this.audit.log(action, {
      actorId,
      targetId,
      targetName,
      metadata: { departmentId },
    });
  }
}
