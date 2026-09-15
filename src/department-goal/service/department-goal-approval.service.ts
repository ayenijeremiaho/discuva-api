import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DepartmentGoalCycle } from '../entity/department-goal-cycle.entity';
import { DepartmentGoalApproval } from '../entity/department-goal-approval.entity';
import { DepartmentGoalComment } from '../entity/department-goal-comment.entity';
import { DepartmentGoalApprovalStatus } from '../enum/department-goal-approval-status.enum';
import {
  ApprovalLevelDto,
  ApprovalDecisionDto,
  SetApprovalLevelOverrideDto,
} from '../dto/department-goal-approval.dto';
import { ApprovalLevelConfig } from '../interface/approval-level.interface';
import { Department } from '../../department/entity/department.entity';
import { DepartmentService } from '../../department/service/department.service';
import { AdminService } from '../../admin/service/admin.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { Admin } from '../../admin/entity/admin.entity';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';

export interface DepartmentGoalApprovalView {
  currentLevel: number;
  totalLevels: number;
  status: DepartmentGoalApprovalStatus;
  completedAt: Date | null;
  currentApproverId: string | null;
  currentApproverName: string | null;
  // True when the CURRENT level's approver comes from this department's own
  // levelOverrides rather than the cycle's default chain.
  isCurrentLevelOverridden: boolean;
}

export interface DepartmentGoalCommentView {
  id: string;
  content: string;
  approvalLevel: number | null;
  decision: 'APPROVED' | 'CHANGES_REQUESTED' | null;
  postedByAdminName: string | null;
  createdAt: Date;
}

@Injectable()
export class DepartmentGoalApprovalService {
  constructor(
    @InjectRepository(DepartmentGoalCycle)
    private readonly cycleRepo: Repository<DepartmentGoalCycle>,
    @InjectRepository(DepartmentGoalApproval)
    private readonly approvalRepo: Repository<DepartmentGoalApproval>,
    @InjectRepository(DepartmentGoalComment)
    private readonly commentRepo: Repository<DepartmentGoalComment>,
    private readonly adminService: AdminService,
    private readonly departmentService: DepartmentService,
    private readonly auditLogService: AuditLogService,
    private readonly notificationDispatchService: NotificationDispatchService,
  ) {}

  // ─── Chain configuration ─────────────────────────────────────────────────

  async validateChain(
    chain: ApprovalLevelDto[] | null | undefined,
  ): Promise<void> {
    if (!chain || chain.length === 0) return;
    if (chain.length > 3) {
      throw new BadRequestException(
        'An approval chain can have at most 3 levels.',
      );
    }

    const levels = [...chain.map((l) => l.level)].sort((a, b) => a - b);
    const expected = Array.from({ length: chain.length }, (_, i) => i + 1);
    if (JSON.stringify(levels) !== JSON.stringify(expected)) {
      throw new BadRequestException(
        'Approval levels must be contiguous starting at 1 (e.g. 1, 2, 3) with no gaps or duplicates.',
      );
    }

    const adminIds = chain.map((l) => l.adminId);
    if (new Set(adminIds).size !== adminIds.length) {
      throw new BadRequestException(
        'The same admin cannot be assigned to more than one level.',
      );
    }

    for (const entry of chain) {
      let admin: Admin;
      try {
        admin = await this.adminService.findById(entry.adminId);
      } catch {
        throw new BadRequestException(
          `Level ${entry.level}'s assigned admin was not found.`,
        );
      }
      if (!admin.isActive) {
        throw new BadRequestException(
          `Level ${entry.level}'s assigned admin is not active.`,
        );
      }
    }
  }

  // Once any department has a recorded decision, the chain's *structure*
  // (which level numbers exist) is locked — reassigning which admin holds an
  // existing level stays allowed at any time, so a departed/deactivated
  // approver doesn't permanently stall a department with no recovery path.
  async assertChainMutable(
    cycleId: string,
    oldChain: ApprovalLevelConfig[] | null,
    newChain: ApprovalLevelDto[] | null | undefined,
  ): Promise<void> {
    const oldLevels = new Set((oldChain ?? []).map((l) => l.level));
    const newLevels = new Set((newChain ?? []).map((l) => l.level));
    const sameStructure =
      oldLevels.size === newLevels.size &&
      [...oldLevels].every((l) => newLevels.has(l));
    if (sameStructure) return;

    const rows = await this.approvalRepo.find({
      where: { cycle: { id: cycleId } },
    });
    const started = rows.some(
      (r) =>
        r.currentLevel > 1 || r.status !== DepartmentGoalApprovalStatus.PENDING,
    );
    if (started) {
      throw new BadRequestException(
        "This cycle's approval chain has already been acted on for at least one department — levels can no longer be added, removed, or reordered. You can still reassign which admin holds an existing level.",
      );
    }
  }

  // ─── Per-department approval state ───────────────────────────────────────

  // Lazy creation — called only when the cycle has a chain configured, only
  // at the moment a department's HOD writes their first goal. A department
  // that never gets a goal never gets a row.
  async getOrCreateApproval(
    cycle: DepartmentGoalCycle,
    departmentId: string,
  ): Promise<DepartmentGoalApproval> {
    let approval = await this.approvalRepo.findOne({
      where: { cycle: { id: cycle.id }, department: { id: departmentId } },
    });
    if (!approval) {
      approval = await this.approvalRepo.save(
        this.approvalRepo.create({
          cycle,
          department: { id: departmentId } as Department,
          currentLevel: 1,
          status: DepartmentGoalApprovalStatus.PENDING,
        }),
      );
    }
    return approval;
  }

  async isApprovalComplete(
    cycle: DepartmentGoalCycle,
    departmentId: string,
  ): Promise<boolean> {
    const approval = await this.approvalRepo.findOne({
      where: { cycle: { id: cycle.id }, department: { id: departmentId } },
    });
    return approval?.status === DepartmentGoalApprovalStatus.COMPLETE;
  }

  // Swaps out the approver for ONE level, for ONE department only — every
  // other department keeps using the cycle's shared chain unchanged. Exists
  // for the case where a cycle-wide approver also happens to be THIS
  // department's own HOD (self-review is always blocked in decide()) —
  // rather than reassigning that level across the whole cycle, this
  // department alone gets a different approver at that level.
  async setLevelOverride(
    cycleId: string,
    departmentId: string,
    dto: SetApprovalLevelOverrideDto,
    actorAdmin: Admin,
  ): Promise<DepartmentGoalApprovalView> {
    const cycle = await this.getCycleOrThrow(cycleId);
    if (!cycle.approvalChain?.length) {
      throw new BadRequestException(
        'This cycle has no approval chain configured.',
      );
    }
    if (dto.level > cycle.approvalChain.length) {
      throw new BadRequestException(
        `This cycle's approval chain only has ${cycle.approvalChain.length} level(s).`,
      );
    }

    const approval = await this.getOrCreateApproval(cycle, departmentId);
    const withoutLevel = (approval.levelOverrides ?? []).filter(
      (l) => l.level !== dto.level,
    );

    if (dto.adminId) {
      let admin: Admin;
      try {
        admin = await this.adminService.findById(dto.adminId);
      } catch {
        throw new BadRequestException('Assigned admin was not found.');
      }
      if (!admin.isActive) {
        throw new BadRequestException('Assigned admin is not active.');
      }

      // Same self-review rule as decide() — an override can't recreate the
      // exact conflict it exists to work around.
      const leads =
        await this.departmentService.getDepartmentLeads(departmentId);
      if (leads.head?.member?.id && leads.head.member.id === admin.member?.id) {
        throw new BadRequestException(
          'This admin is the HOD of this department and cannot be assigned as an approver for it.',
        );
      }

      // Same admin can't hold two levels in this department's EFFECTIVE
      // chain (override applied), mirroring validateChain's rule for the
      // cycle-wide default.
      const effectiveChain = cycle.approvalChain.map(
        (l) => withoutLevel.find((o) => o.level === l.level) ?? l,
      );
      const conflicting = effectiveChain.find(
        (l) => l.level !== dto.level && l.adminId === dto.adminId,
      );
      if (conflicting) {
        throw new BadRequestException(
          `This admin is already assigned to Level ${conflicting.level} for this department.`,
        );
      }

      approval.levelOverrides = [
        ...withoutLevel,
        { level: dto.level, adminId: dto.adminId },
      ];
    } else {
      approval.levelOverrides = withoutLevel.length > 0 ? withoutLevel : null;
    }

    const saved = await this.approvalRepo.save(approval);
    this.auditLogService.log('DEPARTMENT_GOAL_APPROVAL_LEVEL_OVERRIDE_SET', {
      actorId: actorAdmin.member?.id,
      targetId: saved.id,
      metadata: {
        cycleId,
        departmentId,
        level: dto.level,
        adminId: dto.adminId ?? null,
      },
    });

    const approver = await this.resolveApprover(cycle.approvalChain, saved);
    return {
      currentLevel: saved.currentLevel,
      totalLevels: cycle.approvalChain.length,
      status: saved.status,
      completedAt: saved.completedAt,
      currentApproverId: approver?.id ?? null,
      currentApproverName: approver?.name ?? null,
      isCurrentLevelOverridden: !!saved.levelOverrides?.some(
        (l) => l.level === saved.currentLevel,
      ),
    };
  }

  // Called after any successful HOD create/update/delete on a chain-gated
  // cycle. If a level had requested changes, the HOD's edit is treated as a
  // resubmission back to that SAME level — it never skips ahead.
  async onHodGoalWrite(
    cycle: DepartmentGoalCycle,
    departmentId: string,
    memberId: string,
  ): Promise<void> {
    const approval = await this.getOrCreateApproval(cycle, departmentId);
    if (approval.status !== DepartmentGoalApprovalStatus.CHANGES_REQUESTED) {
      return;
    }
    approval.status = DepartmentGoalApprovalStatus.PENDING;
    await this.approvalRepo.save(approval);
    this.auditLogService.log('DEPARTMENT_GOAL_APPROVAL_RESUBMITTED', {
      actorId: memberId,
      targetId: approval.id,
      metadata: {
        cycleId: cycle.id,
        departmentId,
        level: approval.currentLevel,
      },
    });
  }

  async decide(
    cycleId: string,
    departmentId: string,
    dto: ApprovalDecisionDto,
    actorAdmin: Admin,
  ): Promise<DepartmentGoalApproval> {
    const cycle = await this.getCycleOrThrow(cycleId);
    if (!cycle.approvalChain?.length) {
      throw new BadRequestException(
        'This cycle has no approval chain configured.',
      );
    }
    if (!cycle.isActive) {
      throw new BadRequestException('This goal cycle has been deactivated.');
    }

    const approval = await this.getOrCreateApproval(cycle, departmentId);
    if (approval.status === DepartmentGoalApprovalStatus.COMPLETE) {
      throw new BadRequestException(
        'This department has already completed its approval chain.',
      );
    }

    const levelConfig = this.resolveLevelConfig(
      cycle.approvalChain,
      approval.levelOverrides,
      approval.currentLevel,
    );
    if (!levelConfig) {
      throw new BadRequestException(
        'Approval chain configuration is inconsistent for this department.',
      );
    }
    if (levelConfig.adminId !== actorAdmin.id) {
      throw new ForbiddenException(
        `Only the Level ${approval.currentLevel} approver can act on this decision.`,
      );
    }

    const leads = await this.departmentService.getDepartmentLeads(departmentId);
    if (
      leads.head?.member?.id &&
      leads.head.member.id === actorAdmin.member?.id
    ) {
      throw new ForbiddenException(
        'You cannot approve or request changes on goals for a department you head.',
      );
    }

    if (dto.decision === 'REQUEST_CHANGES') {
      if (!dto.comment?.trim()) {
        throw new BadRequestException(
          'A comment is required when requesting changes.',
        );
      }
      const comment = await this.commentRepo.save(
        this.commentRepo.create({
          cycle,
          department: { id: departmentId } as Department,
          postedByAdmin: actorAdmin,
          content: dto.comment.trim(),
          approvalLevel: approval.currentLevel,
          decision: 'CHANGES_REQUESTED',
        }),
      );
      approval.status = DepartmentGoalApprovalStatus.CHANGES_REQUESTED;
      const saved = await this.approvalRepo.save(approval);
      this.auditLogService.log('DEPARTMENT_GOAL_APPROVAL_CHANGES_REQUESTED', {
        actorId: actorAdmin.member?.id,
        targetId: saved.id,
        metadata: { cycleId, departmentId, level: approval.currentLevel },
      });
      this.notifyLeads(leads, {
        title: `Level ${approval.currentLevel} requested changes`,
        body: comment.content,
        comment,
      });
      return saved;
    }

    // APPROVE
    const maxLevel = Math.max(...cycle.approvalChain.map((l) => l.level));
    const approvedLevel = approval.currentLevel;
    const comment = await this.commentRepo.save(
      this.commentRepo.create({
        cycle,
        department: { id: departmentId } as Department,
        postedByAdmin: actorAdmin,
        content: dto.comment?.trim() || 'Approved.',
        approvalLevel: approvedLevel,
        decision: 'APPROVED',
      }),
    );

    let title: string;
    if (approvedLevel === maxLevel) {
      approval.status = DepartmentGoalApprovalStatus.COMPLETE;
      approval.completedAt = new Date();
      title = 'Your department goals have been fully approved';
    } else {
      approval.currentLevel = approvedLevel + 1;
      approval.status = DepartmentGoalApprovalStatus.PENDING;
      title = `Level ${approvedLevel} approved — awaiting Level ${approval.currentLevel}`;
    }
    const saved = await this.approvalRepo.save(approval);
    this.auditLogService.log('DEPARTMENT_GOAL_APPROVAL_APPROVED', {
      actorId: actorAdmin.member?.id,
      targetId: saved.id,
      metadata: { cycleId, departmentId, level: approvedLevel },
    });
    this.notifyLeads(leads, { title, body: comment.content, comment });
    return saved;
  }

  // ─── Comments ─────────────────────────────────────────────────────────────

  async addComment(
    cycleId: string,
    departmentId: string,
    content: string,
    actorAdmin: Admin,
  ): Promise<DepartmentGoalComment> {
    const cycle = await this.getCycleOrThrow(cycleId);
    const comment = await this.commentRepo.save(
      this.commentRepo.create({
        cycle,
        department: { id: departmentId } as Department,
        postedByAdmin: actorAdmin,
        content,
        approvalLevel: null,
        decision: null,
      }),
    );
    this.auditLogService.log('DEPARTMENT_GOAL_COMMENT_ADDED', {
      actorId: actorAdmin.member?.id,
      targetId: comment.id,
      metadata: { cycleId, departmentId },
    });
    const leads = await this.departmentService.getDepartmentLeads(departmentId);
    this.notifyLeads(leads, {
      title: "New comment on your department's goals",
      body: content,
      comment,
    });
    return comment;
  }

  async getThread(
    cycleId: string,
    departmentId: string,
  ): Promise<DepartmentGoalCommentView[]> {
    const comments = await this.commentRepo.find({
      where: { cycle: { id: cycleId }, department: { id: departmentId } },
      relations: ['postedByAdmin', 'postedByAdmin.member'],
      order: { createdAt: 'ASC' },
    });
    return comments.map((c) => ({
      id: c.id,
      content: c.content,
      approvalLevel: c.approvalLevel,
      decision: c.decision,
      postedByAdminName: c.postedByAdmin?.member
        ? `${c.postedByAdmin.member.firstname} ${c.postedByAdmin.member.lastname}`
        : null,
      createdAt: c.createdAt,
    }));
  }

  // ─── Read views ─────────────────────────────────────────────────────────

  async getApprovalStatus(
    cycleId: string,
    departmentId: string,
  ): Promise<DepartmentGoalApprovalView | null> {
    const cycle = await this.getCycleOrThrow(cycleId);
    if (!cycle.approvalChain?.length) return null;
    const approval = await this.approvalRepo.findOne({
      where: { cycle: { id: cycleId }, department: { id: departmentId } },
    });
    if (!approval) return null;
    const approver = await this.resolveApprover(cycle.approvalChain, approval);
    return {
      currentLevel: approval.currentLevel,
      totalLevels: cycle.approvalChain.length,
      status: approval.status,
      completedAt: approval.completedAt,
      currentApproverId: approver?.id ?? null,
      currentApproverName: approver?.name ?? null,
      isCurrentLevelOverridden: !!approval.levelOverrides?.some(
        (l) => l.level === approval.currentLevel,
      ),
    };
  }

  // HOD/Deputy-HOD read access, mirroring DepartmentGoalService.getGoalHistory's
  // own assertIsDepartmentLead gate — these are the member-facing entry
  // points, kept distinct from the plain admin-facing reads above.
  async getApprovalStatusForMember(
    cycleId: string,
    departmentId: string,
    memberId: string,
  ): Promise<DepartmentGoalApprovalView | null> {
    await this.departmentService.assertIsDepartmentLead(memberId, departmentId);
    return this.getApprovalStatus(cycleId, departmentId);
  }

  async getThreadForMember(
    cycleId: string,
    departmentId: string,
    memberId: string,
  ): Promise<DepartmentGoalCommentView[]> {
    await this.departmentService.assertIsDepartmentLead(memberId, departmentId);
    return this.getThread(cycleId, departmentId);
  }

  async getApprovalsForCycle(cycleId: string): Promise<
    (DepartmentGoalApprovalView & {
      departmentId: string;
      departmentName: string;
    })[]
  > {
    const cycle = await this.getCycleOrThrow(cycleId);
    if (!cycle.approvalChain?.length) return [];
    const rows = await this.approvalRepo.find({
      where: { cycle: { id: cycleId } },
      relations: ['department'],
    });
    return Promise.all(
      rows.map(async (r) => {
        const approver = await this.resolveApprover(cycle.approvalChain!, r);
        return {
          departmentId: r.department.id,
          departmentName: r.department.name,
          currentLevel: r.currentLevel,
          totalLevels: cycle.approvalChain!.length,
          status: r.status,
          completedAt: r.completedAt,
          currentApproverId: approver?.id ?? null,
          currentApproverName: approver?.name ?? null,
          isCurrentLevelOverridden: !!r.levelOverrides?.some(
            (l) => l.level === r.currentLevel,
          ),
        };
      }),
    );
  }

  async listActiveAdmins(): Promise<
    { id: string; name: string; email: string }[]
  > {
    const admins = await this.adminService.getAll();
    return admins
      .filter((a) => a.isActive && a.member)
      .map((a) => ({
        id: a.id,
        name: `${a.member.firstname} ${a.member.lastname}`,
        email: a.member.email,
      }));
  }

  // ─── Private helpers ───────────────────────────────────────────────────

  private async getCycleOrThrow(id: string): Promise<DepartmentGoalCycle> {
    const cycle = await this.cycleRepo.findOneBy({ id });
    if (!cycle) throw new NotFoundException('Goal cycle not found');
    return cycle;
  }

  // Sparse override lookup first, falling back to the cycle's shared chain
  // — the single place both decide() and the read views resolve "who is
  // this department's current-level approver" through, so the two can
  // never disagree.
  private resolveLevelConfig(
    chain: ApprovalLevelConfig[],
    overrides: ApprovalLevelConfig[] | null,
    level: number,
  ): ApprovalLevelConfig | undefined {
    return (
      overrides?.find((l) => l.level === level) ??
      chain.find((l) => l.level === level)
    );
  }

  private async resolveApprover(
    chain: ApprovalLevelConfig[],
    approval: DepartmentGoalApproval,
  ): Promise<{ id: string; name: string | null } | null> {
    if (approval.status === DepartmentGoalApprovalStatus.COMPLETE) {
      return null;
    }
    const levelConfig = this.resolveLevelConfig(
      chain,
      approval.levelOverrides,
      approval.currentLevel,
    );
    if (!levelConfig) return null;
    try {
      const admin = await this.adminService.findById(levelConfig.adminId);
      return {
        id: admin.id,
        name: admin.member
          ? `${admin.member.firstname} ${admin.member.lastname}`
          : null,
      };
    } catch {
      return { id: levelConfig.adminId, name: null };
    }
  }

  private notifyLeads(
    leads: { head: WorkerProfile | null; assistant: WorkerProfile | null },
    opts: { title: string; body: string; comment: DepartmentGoalComment },
  ): void {
    const memberIds = [
      leads.head?.member?.id,
      leads.assistant?.member?.id,
    ].filter((id): id is string => !!id);
    if (!memberIds.length) return;
    this.notificationDispatchService.notifyMember({
      category: EmailCategory.DEPARTMENT_GOAL_ACTIVITY,
      push: {
        memberIds,
        title: opts.title,
        body:
          opts.body.length > 120 ? `${opts.body.slice(0, 117)}...` : opts.body,
        url: '/department-goals',
        idempotencyKey: `department-goal-comment:${opts.comment.id}`,
      },
    });
  }
}
