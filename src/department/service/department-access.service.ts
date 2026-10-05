import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { WorkerStatusEnum } from '../../member/enums/worker-status.enum';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { DepartmentLead } from '../entity/department-lead.entity';
import { DepartmentLeadTypeEnum } from '../enums/department-lead-type.enum';
import { DepartmentCapability } from '../enums/department-capability.enum';

// Collapses what used to be 7 near-identical assertIsXDeptWorker() methods
// scattered across services (attendance, evangelism, sunday-school,
// prayer-request, service-session, children-church, follow-up) into one
// shared check. A member has a capability if either their primary or
// secondary department's capabilities array includes it.
@Injectable()
export class DepartmentAccessService {
  constructor(
    @InjectRepository(WorkerProfile)
    private readonly workerProfileRepo: Repository<WorkerProfile>,
    @InjectRepository(DepartmentLead)
    private readonly leadRepo: Repository<DepartmentLead>,
  ) {}

  async hasCapability(
    memberId: string,
    capability: DepartmentCapability,
  ): Promise<boolean> {
    const profile = await this.workerProfileRepo.findOne({
      where: { member: { id: memberId } },
      relations: ['department', 'secondaryDepartment'],
    });
    if (!profile) return false;
    return (
      !!profile.department?.capabilities?.includes(capability) ||
      !!profile.secondaryDepartment?.capabilities?.includes(capability)
    );
  }

  async assertHasCapability(
    memberId: string,
    capability: DepartmentCapability,
    message?: string,
  ): Promise<void> {
    if (await this.hasCapability(memberId, capability)) return;
    throw new ForbiddenException(
      message ??
        `Only workers in a department with the '${capability}' capability can perform this action`,
    );
  }

  // The reverse of hasCapability — "who has capability X" rather than "does
  // this one member have it" — for notification fan-out (e.g. a Sunday
  // School class with no assigned teacher: notify every SS-capability
  // worker instead of nobody). Mirrors the raw capability-join pattern
  // already used inline in FollowUpService.pickRoundRobinAssignee and
  // ServiceSessionService, centralized here so a third call site doesn't
  // repeat it.
  async findMemberIdsWithCapability(
    capability: DepartmentCapability,
  ): Promise<string[]> {
    const rows = await this.workerProfileRepo
      .createQueryBuilder('wp')
      .select('member.id', 'memberId')
      .innerJoin('wp.member', 'member')
      .leftJoin('wp.department', 'd')
      .leftJoin('wp.secondaryDepartment', 'sd')
      .where('(:cap = ANY(d.capabilities) OR :cap = ANY(sd.capabilities))', {
        cap: capability,
      })
      .andWhere('wp.status = :status', { status: WorkerStatusEnum.ACTIVE })
      .getRawMany<{ memberId: string }>();
    return rows.map((r) => r.memberId);
  }

  // Everyone who belongs to a department (primary or secondary), for team-wide notifications.
  async findMemberIdsInDepartment(departmentId: string): Promise<string[]> {
    const rows = await this.workerProfileRepo
      .createQueryBuilder('wp')
      .select('m.id', 'memberId')
      .innerJoin('wp.member', 'm')
      .where(
        '(wp.department_id = :departmentId OR wp.secondary_department_id = :departmentId)',
        { departmentId },
      )
      .andWhere('wp.status = :wpStatus', { wpStatus: WorkerStatusEnum.ACTIVE })
      .andWhere('m.status = :mStatus', { mStatus: MemberStatusEnum.ACTIVE })
      .getRawMany<{ memberId: string }>();
    return rows.map((r) => r.memberId);
  }

  // The departments a member serves in (primary and secondary), for matching team assignments.
  async findDepartmentIdsForMember(memberId: string): Promise<string[]> {
    const profile = await this.workerProfileRepo.findOne({
      where: { member: { id: memberId }, status: WorkerStatusEnum.ACTIVE },
      relations: ['department', 'secondaryDepartment'],
    });
    if (!profile) return [];
    return [profile.department?.id, profile.secondaryDepartment?.id].filter(
      (id): id is string => !!id,
    );
  }

  async findHeadOfDepartment(departmentId: string): Promise<{
    id: string;
    firstname: string;
    lastname: string;
    email: string | null;
  } | null> {
    const lead = await this.leadRepo.findOne({
      where: {
        department: { id: departmentId },
        leadType: DepartmentLeadTypeEnum.HOD,
      },
      relations: ['workerProfile', 'workerProfile.member'],
    });
    const m = lead?.workerProfile?.member;
    return m
      ? {
          id: m.id,
          firstname: m.firstname,
          lastname: m.lastname,
          email: m.email ?? null,
        }
      : null;
  }
}
