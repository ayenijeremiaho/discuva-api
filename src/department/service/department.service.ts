import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { Department } from '../entity/department.entity';
import { DepartmentLead } from '../entity/department-lead.entity';
import { DepartmentLeadTypeEnum } from '../enums/department-lead-type.enum';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { WorkerStatusEnum } from '../../member/enums/worker-status.enum';
import { RequestLeave } from '../../request-leave/enitity/request-leave.entity';
import { LeaveStatusEnum } from '../../request-leave/enums/leave-status.enum';
import { Attendance } from '../../attendance/entity/attendance.entity';
import { CreateDepartmentDto } from '../dto/create-department.dto';
import { UpdateDepartmentDto } from '../dto/update-department.dto';
import { AssignDepartmentHodDto } from '../dto/assign-department-hod.dto';
import { RemoveDepartmentHodDto } from '../dto/remove-department-hod.dto';
import { BulkAssignDepartmentDto } from '../dto/bulk-assign-department.dto';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { ConfigService } from '@nestjs/config';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { CacheService } from '../../utility/service/cache.service';

export interface DepartmentSummary {
  departmentId: string;
  departmentName: string;
  myLeadRole: 'head' | 'assistant' | 'admin';
  totalWorkers: number;
  activeWorkers: number;
  inactiveWorkers: number;
  attendancePercentage: number;
  workersOnLeave: {
    workerProfileId: string;
    memberId: string;
    name: string;
    status: LeaveStatusEnum;
    dateFrom: Date;
    dateTo: Date;
  }[];
}

@Injectable()
export class DepartmentService {
  private static readonly CACHE_KEY = 'departments:all';
  private readonly cacheTtl: number;

  constructor(
    @InjectRepository(Department)
    private readonly departmentRepository: Repository<Department>,
    @InjectRepository(DepartmentLead)
    private readonly leadRepository: Repository<DepartmentLead>,
    @InjectRepository(WorkerProfile)
    private readonly workerProfileRepository: Repository<WorkerProfile>,
    @InjectRepository(RequestLeave)
    private readonly leaveRepository: Repository<RequestLeave>,
    @InjectRepository(Attendance)
    private readonly attendanceRepository: Repository<Attendance>,
    private readonly cacheService: CacheService,
    private readonly configService: ConfigService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.cacheTtl = this.configService.get<number>(
      'CACHE_TTL_REFERENCE_SECONDS',
    );
  }

  private readonly logger = new Logger(DepartmentService.name);

  async create(dto: CreateDepartmentDto, actorId: string): Promise<Department> {
    await this.assertNameUnique(dto.name);
    const dept = await this.departmentRepository.save({ ...dto });
    this.cacheService.del(DepartmentService.CACHE_KEY);
    this.auditLogService.log('DEPARTMENT_CREATED', {
      actorId,
      targetId: dept.id,
      targetName: dept.name,
      metadata: { name: dept.name },
    });
    return dept;
  }

  async getOne(id: string): Promise<Department> {
    return this.getDepartmentOrThrow(id);
  }

  async getAll(): Promise<Department[]> {
    let all = await this.cacheService.get<Department[]>(
      DepartmentService.CACHE_KEY,
    );
    if (!all) {
      all = await this.departmentRepository.find({
        order: { createdAt: 'DESC' },
      });
      this.cacheService.set(DepartmentService.CACHE_KEY, all, this.cacheTtl);
    }
    return all;
  }

  async update(
    id: string,
    dto: UpdateDepartmentDto,
    actorId: string,
  ): Promise<Department> {
    const department = await this.getDepartmentOrThrow(id);

    if (dto.name && dto.name !== department.name) {
      await this.assertNameUnique(dto.name);
      department.name = dto.name;
    }
    if (dto.description) department.description = dto.description;
    if ('capabilities' in dto) department.capabilities = dto.capabilities ?? [];

    const updated = await this.departmentRepository.save(department);
    this.cacheService.del(DepartmentService.CACHE_KEY);
    this.auditLogService.log('DEPARTMENT_UPDATED', {
      actorId,
      targetId: id,
      targetName: updated.name,
      metadata: { name: updated.name, changes: Object.keys(dto) },
    });
    return updated;
  }

  async delete(id: string, actorId: string): Promise<void> {
    const department = await this.getDepartmentOrThrow(id);

    const [hasPrimaryWorkers, hasSecondaryWorkers] = await Promise.all([
      this.workerProfileRepository.exists({ where: { department: { id } } }),
      this.workerProfileRepository.exists({
        where: { secondaryDepartment: { id } },
      }),
    ]);
    if (hasPrimaryWorkers || hasSecondaryWorkers) {
      this.logger.warn(
        `Delete of department "${department.name}" blocked — workers are still assigned`,
      );
      throw new BadRequestException(
        `${department.name} has workers assigned and cannot be deleted`,
      );
    }

    const { name } = department;
    await this.departmentRepository.delete(id);
    this.cacheService.del(DepartmentService.CACHE_KEY);
    this.auditLogService.log('DEPARTMENT_DELETED', {
      actorId,
      targetId: id,
      targetName: name,
      metadata: { name },
    });
  }

  async assignLead(
    dto: AssignDepartmentHodDto,
    actorId: string,
  ): Promise<Department> {
    const { departmentId, memberId, type } = dto;

    const department = await this.getDepartmentOrThrow(departmentId);

    const profile = await this.workerProfileRepository.findOne({
      where: [
        { member: { id: memberId }, department: { id: departmentId } },
        { member: { id: memberId }, secondaryDepartment: { id: departmentId } },
      ],
    });
    if (!profile)
      throw new NotFoundException('Worker is not a member of this department');

    const leadType =
      type === 'head'
        ? DepartmentLeadTypeEnum.HOD
        : DepartmentLeadTypeEnum.D_HOD;

    const existing = await this.leadRepository.findOne({
      where: { department: { id: departmentId }, leadType },
      relations: ['workerProfile'],
    });

    if (existing?.workerProfile.id === profile.id) {
      throw new BadRequestException(
        'This worker is already assigned to that lead role',
      );
    }

    // A worker can now legitimately hold lead rows in several DIFFERENT
    // departments (see department-lead.entity.ts's ManyToOne), but holding
    // BOTH lead types within the SAME department is never valid — HOD and
    // Deputy HOD are supposed to be two different people. The old
    // UNIQUE(worker_profile_id) constraint used to block this only as an
    // accidental side effect of blocking every multi-row case; removing it
    // to enable multi-department leadership reopened this specific gap, so
    // it needs its own explicit check now.
    const otherLeadType =
      leadType === DepartmentLeadTypeEnum.HOD
        ? DepartmentLeadTypeEnum.D_HOD
        : DepartmentLeadTypeEnum.HOD;
    const conflictingLead = await this.leadRepository.findOne({
      where: {
        department: { id: departmentId },
        leadType: otherLeadType,
        workerProfile: { id: profile.id },
      },
    });
    if (conflictingLead) {
      throw new BadRequestException(
        `This worker already holds the ${otherLeadType === DepartmentLeadTypeEnum.HOD ? 'HOD' : 'Deputy HOD'} role for this department — remove that assignment first if you want to reassign them.`,
      );
    }

    if (existing) await this.leadRepository.remove(existing);

    await this.leadRepository.save(
      this.leadRepository.create({
        workerProfile: profile,
        department,
        leadType,
      }),
    );

    this.auditLogService.log('DEPARTMENT_LEAD_ASSIGNED', {
      actorId,
      targetId: departmentId,
      targetName: department.name,
      metadata: { memberId, type },
    });
    return department;
  }

  async removeLead(
    dto: RemoveDepartmentHodDto,
    actorId: string,
  ): Promise<Department> {
    const { departmentId, type } = dto;
    const department = await this.getDepartmentOrThrow(departmentId);

    const leadType =
      type === 'head'
        ? DepartmentLeadTypeEnum.HOD
        : DepartmentLeadTypeEnum.D_HOD;
    const lead = await this.leadRepository.findOne({
      where: { department: { id: departmentId }, leadType },
    });

    if (!lead)
      throw new BadRequestException(`No ${type} assigned to this department`);

    await this.leadRepository.remove(lead);
    this.auditLogService.log('DEPARTMENT_LEAD_REMOVED', {
      actorId,
      targetId: departmentId,
      targetName: department.name,
      metadata: { type },
    });
    return department;
  }

  async getDepartmentLeads(departmentId: string) {
    const department = await this.getDepartmentOrThrow(departmentId);

    const leads = await this.leadRepository.find({
      where: { department: { id: departmentId } },
      relations: ['workerProfile', 'workerProfile.member'],
    });

    const find = (t: DepartmentLeadTypeEnum) =>
      leads.find((l) => l.leadType === t)?.workerProfile ?? null;

    return {
      name: department.name,
      head: find(DepartmentLeadTypeEnum.HOD),
      assistant: find(DepartmentLeadTypeEnum.D_HOD),
    };
  }

  async getAllLeads(): Promise<DepartmentLead[]> {
    return this.leadRepository.find({
      relations: ['workerProfile', 'workerProfile.member', 'department'],
    });
  }

  async isMemberDepartmentLead(memberId: string): Promise<boolean> {
    return this.leadRepository.exists({
      where: { workerProfile: { member: { id: memberId } } },
    });
  }

  // Resolves which department a lead-scoped action applies to, now that a
  // worker can genuinely lead more than one department (see
  // department-lead.entity.ts's ManyToOne — this used to be impossible, so
  // the old getDepartmentIdForLead's arbitrary findOne() was safe by
  // accident). If departmentId is supplied, the caller must actually lead
  // it. If not supplied, auto-detect ONLY when the member leads exactly
  // one department — preserving today's no-param call sites for the common
  // single-department case — otherwise reject rather than silently guess.
  async resolveLeadDepartmentId(
    memberId: string,
    departmentId?: string,
  ): Promise<string> {
    if (departmentId) {
      await this.assertIsDepartmentLead(memberId, departmentId);
      return departmentId;
    }
    const roles = await this.getLeadRoles(memberId);
    const uniqueDeptIds = Array.from(new Set(roles.map((r) => r.departmentId)));
    if (uniqueDeptIds.length === 0) {
      throw new ForbiddenException('You are not a lead of any department.');
    }
    if (uniqueDeptIds.length > 1) {
      throw new BadRequestException(
        'You lead more than one department — specify which department this request is for.',
      );
    }
    return uniqueDeptIds[0];
  }

  // Scoped to a SPECIFIC department — a member can lead more than one, so
  // there's no such thing as safely resolving "the" department for them
  // without a department already in hand. Callers needing "is this member
  // allowed to act on department X" must use this.
  async assertIsDepartmentLead(
    memberId: string,
    departmentId: string,
    leadType?: DepartmentLeadTypeEnum,
  ): Promise<DepartmentLead> {
    const lead = await this.leadRepository.findOne({
      where: {
        workerProfile: { member: { id: memberId } },
        department: { id: departmentId },
        ...(leadType ? { leadType } : {}),
      },
      relations: ['department'],
    });
    if (!lead) {
      throw new ForbiddenException('You are not a lead of this department.');
    }
    return lead;
  }

  // Every department a member leads (HOD or Deputy-HOD) — a member can lead
  // more than one, so this returns a list rather than assuming one.
  async getLeadRoles(memberId: string): Promise<
    {
      departmentId: string;
      departmentName: string;
      leadType: DepartmentLeadTypeEnum;
    }[]
  > {
    const leads = await this.leadRepository.find({
      where: { workerProfile: { member: { id: memberId } } },
      relations: ['department'],
    });
    return leads.map((l) => ({
      departmentId: l.department.id,
      departmentName: l.department.name,
      leadType: l.leadType,
    }));
  }

  // A worker counts as "in" a department via EITHER their primary or their
  // alternate (secondary) department — mirrors the same OR already applied
  // in delete()'s hasPrimaryWorkers/hasSecondaryWorkers check below, so a
  // department's roster/lead-eligible-worker list doesn't silently exclude
  // someone who's only assigned to it as an alternate.
  async getWorkersInDepartment(departmentId: string): Promise<WorkerProfile[]> {
    return this.workerProfileRepository.find({
      where: [
        { department: { id: departmentId } },
        { secondaryDepartment: { id: departmentId } },
      ],
      relations: ['member'],
      order: { createdAt: 'ASC' },
    });
  }

  async getWorkersByDepartment(
    departmentId: string,
    page = 1,
    limit = 20,
  ): Promise<
    PaginationResponseDto<
      WorkerProfile & { leadRole: 'head' | 'assistant' | null }
    >
  > {
    if (page < 1) throw new BadRequestException('Page must be greater than 0');

    await this.getDepartmentOrThrow(departmentId);

    const [[profiles, total], leads] = await Promise.all([
      this.workerProfileRepository.findAndCount({
        where: [
          { department: { id: departmentId } },
          { secondaryDepartment: { id: departmentId } },
        ],
        relations: ['member'],
        skip: (page - 1) * limit,
        take: limit,
        order: { createdAt: 'ASC' },
      }),
      this.leadRepository.find({
        where: { department: { id: departmentId } },
        relations: ['workerProfile'],
      }),
    ]);

    const leadMap = new Map<string, 'head' | 'assistant'>();
    for (const lead of leads) {
      leadMap.set(
        lead.workerProfile.id,
        lead.leadType === DepartmentLeadTypeEnum.HOD ? 'head' : 'assistant',
      );
    }

    const annotated = profiles.map((p) => ({
      ...p,
      leadRole: leadMap.get(p.id) ?? null,
    })) as (WorkerProfile & { leadRole: 'head' | 'assistant' | null })[];

    return UtilityService.createPaginationResponse(
      annotated,
      page,
      limit,
      total,
    );
  }

  async getDepartmentSummary(
    user: MemberAuth,
    departmentId?: string,
  ): Promise<DepartmentSummary> {
    const deptId = await this.resolveLeadDepartmentId(user.id, departmentId);
    // Already confirmed the caller leads deptId above — this fetch is now
    // fully scoped (not the old ambiguous findOne), just re-loading the row
    // for its department name/leadType.
    const lead = await this.leadRepository.findOne({
      where: {
        workerProfile: { member: { id: user.id } },
        department: { id: deptId },
      },
      relations: ['department'],
    });
    if (!lead)
      throw new ForbiddenException(
        'You must be a department lead to perform this action.',
      );
    const departmentName = lead.department.name;
    const myLeadRole =
      lead.leadType === DepartmentLeadTypeEnum.HOD ? 'head' : 'assistant';

    const today = new Date();
    const since = new Date();
    since.setDate(since.getDate() - 30);

    // Every count below is OR'd across primary/secondary department — same
    // reasoning as getWorkersInDepartment/getWorkersByDepartment above, and
    // the same fix those two already got. Without this, a worker whose
    // ALTERNATE department is deptId would show up in the Attendance
    // screen's roster (which goes through getWorkersInDepartment) but be
    // invisible in this summary's totals — an inconsistency between the
    // two screens, not just an undercount on its own.
    const [totalWorkers, activeWorkers, onLeave, attendanceResult] =
      await Promise.all([
        this.workerProfileRepository.count({
          where: [
            { department: { id: deptId } },
            { secondaryDepartment: { id: deptId } },
          ],
        }),
        this.workerProfileRepository.count({
          where: [
            { department: { id: deptId }, status: WorkerStatusEnum.ACTIVE },
            {
              secondaryDepartment: { id: deptId },
              status: WorkerStatusEnum.ACTIVE,
            },
          ],
        }),
        this.leaveRepository.find({
          where: [
            {
              workerProfile: { department: { id: deptId } },
              status: LeaveStatusEnum.PENDING,
            },
            {
              workerProfile: { department: { id: deptId } },
              status: LeaveStatusEnum.APPROVED,
              dateTo: MoreThanOrEqual(today),
            },
            {
              workerProfile: { secondaryDepartment: { id: deptId } },
              status: LeaveStatusEnum.PENDING,
            },
            {
              workerProfile: { secondaryDepartment: { id: deptId } },
              status: LeaveStatusEnum.APPROVED,
              dateTo: MoreThanOrEqual(today),
            },
          ],
          relations: ['workerProfile', 'workerProfile.member'],
          order: { createdAt: 'DESC' },
        }),
        this.attendanceRepository
          .createQueryBuilder('a')
          .select('COUNT(DISTINCT a.member_id)', 'attended')
          .innerJoin(
            'worker_profiles',
            'wp',
            "wp.member_id = a.member_id AND wp.status = 'ACTIVE'",
          )
          .where(
            '(wp.department_id = :deptId OR wp.secondary_department_id = :deptId)',
            { deptId },
          )
          .andWhere("a.status IN ('PRESENT', 'LATE')")
          .andWhere('a.createdAt >= :since', { since })
          .andWhere('a.roleAtCheckin = :role', { role: 'WORKER' })
          .getRawOne<{ attended: string }>(),
      ]);

    const attended = Number.parseInt(attendanceResult?.attended ?? '0', 10);
    const attendancePercentage =
      activeWorkers === 0
        ? 0
        : Math.min(Number(((attended / activeWorkers) * 100).toFixed(2)), 100);

    return {
      departmentId: deptId,
      departmentName,
      myLeadRole,
      totalWorkers,
      activeWorkers,
      inactiveWorkers: totalWorkers - activeWorkers,
      attendancePercentage,
      workersOnLeave: onLeave.map((l) => ({
        workerProfileId: l.workerProfile.id,
        memberId: l.workerProfile.member.id,
        name: `${l.workerProfile.member.firstname} ${l.workerProfile.member.lastname}`,
        status: l.status,
        dateFrom: l.dateFrom,
        dateTo: l.dateTo,
      })),
    };
  }

  async bulkAssignDepartment(
    departmentId: string,
    dto: BulkAssignDepartmentDto,
    actorId: string,
  ): Promise<{ updated: number; skipped: number }> {
    const department = await this.getDepartmentOrThrow(departmentId);

    // Batched instead of a findOne+save per member — one existence check +
    // one bulk UPDATE regardless of how many ids are submitted.
    const uniqueIds = Array.from(new Set(dto.memberIds));
    const existingRows = await this.workerProfileRepository
      .createQueryBuilder('wp')
      .select('wp.member_id', 'memberId')
      .where('wp.member_id IN (:...ids)', { ids: uniqueIds })
      .getRawMany<{ memberId: string }>();
    const existingIds = existingRows.map((r) => r.memberId);
    const updated = existingIds.length;
    const skipped = uniqueIds.length - updated;

    if (updated > 0) {
      await this.workerProfileRepository
        .createQueryBuilder()
        .update(WorkerProfile)
        .set({ department: { id: departmentId } as Department })
        .where('member_id IN (:...ids)', { ids: existingIds })
        .execute();
      // Bulk-assigning this department as PRIMARY makes it redundant for
      // anyone who already held it as their secondary — a worker can't
      // have the same department as both, so clear it rather than leave a
      // silent collision (this raw update bypasses entity hydration, so
      // the same check inside updateWorkerProfile never runs for this path).
      await this.workerProfileRepository
        .createQueryBuilder()
        .update(WorkerProfile)
        .set({ secondaryDepartment: null })
        .where('member_id IN (:...ids)', { ids: existingIds })
        .andWhere('secondary_department_id = :departmentId', { departmentId })
        .execute();
    }

    this.auditLogService.log('BULK_DEPARTMENT_ASSIGNED', {
      actorId,
      targetId: departmentId,
      targetName: department.name,
      metadata: { updated, skipped, memberIds: existingIds },
    });

    return { updated, skipped };
  }

  private async getDepartmentOrThrow(id: string): Promise<Department> {
    const dept = await this.departmentRepository.findOneBy({ id });
    if (!dept) throw new NotFoundException('Department not found');
    return dept;
  }

  private async assertNameUnique(name: string): Promise<void> {
    if (await this.departmentRepository.existsBy({ name })) {
      throw new BadRequestException('Department name already exists');
    }
  }
}
