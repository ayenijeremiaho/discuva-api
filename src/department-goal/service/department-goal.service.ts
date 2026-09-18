import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DepartmentGoalCycle } from '../entity/department-goal-cycle.entity';
import { DepartmentGoal } from '../entity/department-goal.entity';
import { GoalCycleStage } from '../enum/goal-cycle-stage.enum';
import {
  CreateGoalCycleDto,
  CreateGoalDto,
  SubmitRatingDto,
  UpdateGoalCycleDto,
  UpdateGoalDto,
} from '../dto/department-goal.dto';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { Department } from '../../department/entity/department.entity';
import { DepartmentLeadTypeEnum } from '../../department/enums/department-lead-type.enum';
import { DepartmentService } from '../../department/service/department.service';
import { DateService } from '../../utility/service/date.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { Admin } from '../../admin/entity/admin.entity';
import { Member } from '../../member/entity/member.entity';
import { PdfService } from '../../utility/service/pdf.service';
import { DepartmentGoalApprovalService } from './department-goal-approval.service';

export interface GoalView {
  id: string;
  title: string;
  description: string | null;
  timelineToAchieve: string | null;
  churchRating: number | null;
  churchRatingReason: string | null;
  selfRating: number | null;
  selfRatingReason: string | null;
}

export interface MemberDepartmentGoals {
  departmentId: string;
  departmentName: string;
  role: 'HOD' | 'DEPUTY_HOD' | 'MEMBER';
  // null = withheld — a plain member while the cycle is still OPENING (see
  // the confirmed visibility rule: only HOD/Deputy-HOD see drafts live).
  goals: GoalView[] | null;
}

export interface MemberCurrentGoalsResponse {
  cycle: {
    id: string;
    name: string;
    startDate: string;
    graceDeadline: string;
    endDate: string;
    stage: GoalCycleStage;
    // Lets the member frontend avoid promising review starts exactly at
    // endDate — when a chain is configured, submitSelfRating also
    // requires that department's approval to be COMPLETE
    // (assertApprovalComplete), which can push review later than the
    // date alone would suggest.
    hasApprovalChain: boolean;
  } | null;
  departments: MemberDepartmentGoals[];
}

export interface DepartmentGoalReportRow {
  departmentId: string;
  departmentName: string;
  avgSelfScore: number | null;
  avgChurchScore: number | null;
  gap: number | null;
}

@Injectable()
export class DepartmentGoalService {
  constructor(
    @InjectRepository(DepartmentGoalCycle)
    private readonly cycleRepo: Repository<DepartmentGoalCycle>,
    @InjectRepository(DepartmentGoal)
    private readonly goalRepo: Repository<DepartmentGoal>,
    @InjectRepository(WorkerProfile)
    private readonly workerProfileRepo: Repository<WorkerProfile>,
    private readonly departmentService: DepartmentService,
    private readonly dateService: DateService,
    private readonly auditLogService: AuditLogService,
    private readonly pdfService: PdfService,
    private readonly approvalService: DepartmentGoalApprovalService,
  ) {}

  // The single place a cycle's stage is derived — see the plan's own note
  // on why every call site must go through this rather than comparing
  // dates directly (a real instance of that exact bug already exists
  // elsewhere in this codebase, in pledge.service.ts).
  getEffectiveStage(
    cycle: DepartmentGoalCycle,
    today: string = this.dateService.today(),
  ): GoalCycleStage {
    if (!cycle.isActive) return GoalCycleStage.INACTIVE;
    if (today < cycle.graceDeadline) return GoalCycleStage.OPENING;
    if (today < cycle.endDate) return GoalCycleStage.IN_PROGRESS;
    return GoalCycleStage.REVIEWED;
  }

  // ─── Cycles (admin) ──────────────────────────────────────────────────────

  async createCycle(
    dto: CreateGoalCycleDto,
    admin: Admin,
  ): Promise<DepartmentGoalCycle> {
    this.assertValidDateRange(dto.startDate, dto.graceDeadline, dto.endDate);
    await this.approvalService.validateChain(dto.approvalChain);
    const cycle = this.cycleRepo.create({
      name: dto.name,
      startDate: dto.startDate,
      graceDeadline: dto.graceDeadline,
      endDate: dto.endDate,
      approvalChain: dto.approvalChain ?? null,
    });
    const saved = await this.cycleRepo.save(cycle);
    this.auditLogService.log('DEPARTMENT_GOAL_CYCLE_CREATED', {
      actorId: admin.id,
      targetId: saved.id,
      targetName: saved.name,
    });
    return saved;
  }

  async getAllCycles(): Promise<DepartmentGoalCycle[]> {
    return this.cycleRepo.find({ order: { startDate: 'DESC' } });
  }

  async getCycleOrThrow(id: string): Promise<DepartmentGoalCycle> {
    const cycle = await this.cycleRepo.findOneBy({ id });
    if (!cycle) throw new NotFoundException('Goal cycle not found');
    return cycle;
  }

  async updateCycle(
    id: string,
    dto: UpdateGoalCycleDto,
    admin: Admin,
  ): Promise<DepartmentGoalCycle> {
    const cycle = await this.getCycleOrThrow(id);

    const nextStart = dto.startDate ?? cycle.startDate;
    const nextGrace = dto.graceDeadline ?? cycle.graceDeadline;
    const nextEnd = dto.endDate ?? cycle.endDate;
    if (
      dto.startDate !== undefined ||
      dto.graceDeadline !== undefined ||
      dto.endDate !== undefined
    ) {
      // Re-validated here too, not just on create — this is exactly the
      // "move the grace deadline anytime" path, the likeliest place to skip
      // the check if it were only enforced at creation.
      this.assertValidDateRange(nextStart, nextGrace, nextEnd);
    }

    if (dto.name !== undefined) cycle.name = dto.name;
    cycle.startDate = nextStart;
    cycle.graceDeadline = nextGrace;
    cycle.endDate = nextEnd;
    if (dto.isActive !== undefined) cycle.isActive = dto.isActive;

    if (dto.approvalChain !== undefined) {
      await this.approvalService.validateChain(dto.approvalChain);
      await this.approvalService.assertChainMutable(
        id,
        cycle.approvalChain,
        dto.approvalChain,
      );
      cycle.approvalChain = dto.approvalChain;
    }

    const saved = await this.cycleRepo.save(cycle);
    this.auditLogService.log('DEPARTMENT_GOAL_CYCLE_UPDATED', {
      actorId: admin.id,
      targetId: id,
      targetName: saved.name,
      metadata: { changes: Object.keys(dto) },
    });
    return saved;
  }

  // ─── Cross-department view + church rating flow (admin) ─────────────────

  async getGoalsForCycle(cycleId: string): Promise<DepartmentGoal[]> {
    await this.getCycleOrThrow(cycleId);
    return this.goalRepo.find({
      where: { cycle: { id: cycleId } },
      relations: ['department'],
      order: { createdAt: 'ASC' },
    });
  }

  async correctGoal(
    cycleId: string,
    goalId: string,
    dto: UpdateGoalDto,
    admin: Admin,
  ): Promise<DepartmentGoal> {
    const cycle = await this.getCycleOrThrow(cycleId);
    if (this.getEffectiveStage(cycle) !== GoalCycleStage.IN_PROGRESS) {
      throw new BadRequestException(
        'Goals can only be corrected while the cycle is in progress.',
      );
    }
    const goal = await this.getGoalOrThrow(cycleId, goalId);
    this.assertNotFrozen(goal);

    const before = {
      title: goal.title,
      description: goal.description,
      timelineToAchieve: goal.timelineToAchieve,
    };
    if (dto.title !== undefined) goal.title = dto.title;
    if (dto.description !== undefined) goal.description = dto.description;
    if (dto.timelineToAchieve !== undefined) {
      goal.timelineToAchieve = dto.timelineToAchieve;
    }
    const saved = await this.goalRepo.save(goal);

    this.auditLogService.log('DEPARTMENT_GOAL_CORRECTED', {
      actorId: admin.member?.id,
      targetId: goalId,
      targetName: saved.title,
      metadata: {
        before,
        after: {
          title: saved.title,
          description: saved.description,
          timelineToAchieve: saved.timelineToAchieve,
        },
      },
    });
    return saved;
  }

  async submitChurchRating(
    cycleId: string,
    goalId: string,
    dto: SubmitRatingDto,
    admin: Admin,
  ): Promise<DepartmentGoal> {
    const cycle = await this.getCycleOrThrow(cycleId);
    if (this.getEffectiveStage(cycle) !== GoalCycleStage.REVIEWED) {
      throw new BadRequestException(
        'The church can only rate a goal once the cycle has ended.',
      );
    }
    const goal = await this.getGoalOrThrow(cycleId, goalId);
    await this.assertApprovalComplete(cycle, goal.department.id);
    if (goal.churchRating !== null) {
      throw new BadRequestException(
        'This goal has already been rated by the church.',
      );
    }

    goal.churchRating = dto.rating;
    goal.churchRatingReason = dto.reason;
    goal.churchRatedAt = new Date();
    goal.churchRatedByAdmin = { id: admin.id } as Admin;
    const saved = await this.goalRepo.save(goal);

    this.auditLogService.log('DEPARTMENT_GOAL_CHURCH_RATED', {
      actorId: admin.member?.id,
      targetId: goalId,
      targetName: saved.title,
      metadata: { rating: dto.rating },
    });
    return saved;
  }

  async getReport(cycleId: string): Promise<DepartmentGoalReportRow[]> {
    await this.getCycleOrThrow(cycleId);
    const rows = await this.goalRepo
      .createQueryBuilder('g')
      .innerJoin('g.department', 'd')
      .select('d.id', 'departmentId')
      .addSelect('d.name', 'departmentName')
      .addSelect('AVG(g.self_rating)', 'avgSelfScore')
      .addSelect('AVG(g.church_rating)', 'avgChurchScore')
      .where('g.cycle_id = :cycleId', { cycleId })
      .groupBy('d.id')
      .addGroupBy('d.name')
      .orderBy('d.name', 'ASC')
      .getRawMany<{
        departmentId: string;
        departmentName: string;
        avgSelfScore: string | null;
        avgChurchScore: string | null;
      }>();

    return rows.map((r) => {
      const avgSelf =
        r.avgSelfScore !== null
          ? Number(Number(r.avgSelfScore).toFixed(2))
          : null;
      const avgChurch =
        r.avgChurchScore !== null
          ? Number(Number(r.avgChurchScore).toFixed(2))
          : null;
      return {
        departmentId: r.departmentId,
        departmentName: r.departmentName,
        avgSelfScore: avgSelf,
        avgChurchScore: avgChurch,
        gap:
          avgSelf !== null && avgChurch !== null
            ? Number((avgSelf - avgChurch).toFixed(2))
            : null,
      };
    });
  }

  // ─── Member-facing (HOD write, Deputy-HOD/member read) ──────────────────

  async getCurrentForMember(
    memberId: string,
  ): Promise<MemberCurrentGoalsResponse> {
    const cycle = await this.cycleRepo.findOne({
      where: { isActive: true },
      order: { startDate: 'DESC' },
    });
    if (!cycle) return { cycle: null, departments: [] };

    const stage = this.getEffectiveStage(cycle);
    const leadRoles = await this.departmentService.getLeadRoles(memberId);
    const leadDeptIds = new Set(leadRoles.map((l) => l.departmentId));

    const profile = await this.workerProfileRepo.findOne({
      where: { member: { id: memberId } },
      relations: ['department', 'secondaryDepartment'],
    });

    const plainDepts: { id: string; name: string }[] = [];
    if (profile?.department && !leadDeptIds.has(profile.department.id)) {
      plainDepts.push({
        id: profile.department.id,
        name: profile.department.name,
      });
    }
    if (
      profile?.secondaryDepartment &&
      profile.secondaryDepartment.id !== profile.department?.id &&
      !leadDeptIds.has(profile.secondaryDepartment.id)
    ) {
      plainDepts.push({
        id: profile.secondaryDepartment.id,
        name: profile.secondaryDepartment.name,
      });
    }

    const relevant: {
      departmentId: string;
      departmentName: string;
      role: 'HOD' | 'DEPUTY_HOD' | 'MEMBER';
    }[] = [
      ...leadRoles.map((l) => ({
        departmentId: l.departmentId,
        departmentName: l.departmentName,
        role: (l.leadType === DepartmentLeadTypeEnum.HOD
          ? 'HOD'
          : 'DEPUTY_HOD') as 'HOD' | 'DEPUTY_HOD',
      })),
      ...plainDepts.map((d) => ({
        departmentId: d.id,
        departmentName: d.name,
        role: 'MEMBER' as const,
      })),
    ];

    const departments = await Promise.all(
      relevant.map(async (r): Promise<MemberDepartmentGoals> => {
        const withheld =
          r.role === 'MEMBER' && stage === GoalCycleStage.OPENING;
        if (withheld) {
          return {
            departmentId: r.departmentId,
            departmentName: r.departmentName,
            role: r.role,
            goals: null,
          };
        }
        const goals = await this.goalRepo.find({
          where: {
            cycle: { id: cycle.id },
            department: { id: r.departmentId },
          },
          order: { createdAt: 'ASC' },
        });
        return {
          departmentId: r.departmentId,
          departmentName: r.departmentName,
          role: r.role,
          goals: goals.map((g) => this.toGoalView(g)),
        };
      }),
    );

    return {
      cycle: {
        id: cycle.id,
        name: cycle.name,
        startDate: cycle.startDate,
        graceDeadline: cycle.graceDeadline,
        endDate: cycle.endDate,
        stage,
        hasApprovalChain: !!cycle.approvalChain?.length,
      },
      departments,
    };
  }

  async createGoal(
    cycleId: string,
    departmentId: string,
    dto: CreateGoalDto,
    memberId: string,
  ): Promise<DepartmentGoal> {
    const cycle = await this.getCycleOrThrow(cycleId);
    await this.departmentService.assertIsDepartmentLead(
      memberId,
      departmentId,
      DepartmentLeadTypeEnum.HOD,
    );
    await this.assertGoalWritable(cycle, departmentId);

    const goal = this.goalRepo.create({
      cycle,
      department: { id: departmentId } as Department,
      title: dto.title,
      description: dto.description ?? null,
      timelineToAchieve: dto.timelineToAchieve ?? null,
    });
    const saved = await this.goalRepo.save(goal);
    this.auditLogService.log('DEPARTMENT_GOAL_CREATED', {
      actorId: memberId,
      targetId: saved.id,
      targetName: saved.title,
      metadata: { cycleId, departmentId },
    });
    if (cycle.approvalChain?.length) {
      await this.approvalService.onHodGoalWrite(cycle, departmentId, memberId);
    }
    return saved;
  }

  async updateGoalAsHod(
    cycleId: string,
    departmentId: string,
    goalId: string,
    dto: UpdateGoalDto,
    memberId: string,
  ): Promise<DepartmentGoal> {
    const cycle = await this.getCycleOrThrow(cycleId);
    await this.departmentService.assertIsDepartmentLead(
      memberId,
      departmentId,
      DepartmentLeadTypeEnum.HOD,
    );
    await this.assertGoalWritable(cycle, departmentId);
    const goal = await this.getGoalOrThrow(cycleId, goalId, departmentId);
    this.assertNotFrozen(goal);

    if (dto.title !== undefined) goal.title = dto.title;
    if (dto.description !== undefined) goal.description = dto.description;
    if (dto.timelineToAchieve !== undefined) {
      goal.timelineToAchieve = dto.timelineToAchieve;
    }
    const saved = await this.goalRepo.save(goal);
    this.auditLogService.log('DEPARTMENT_GOAL_UPDATED', {
      actorId: memberId,
      targetId: goalId,
      targetName: saved.title,
      metadata: { cycleId, departmentId },
    });
    if (cycle.approvalChain?.length) {
      await this.approvalService.onHodGoalWrite(cycle, departmentId, memberId);
    }
    return saved;
  }

  async deleteGoalAsHod(
    cycleId: string,
    departmentId: string,
    goalId: string,
    memberId: string,
  ): Promise<void> {
    const cycle = await this.getCycleOrThrow(cycleId);
    await this.departmentService.assertIsDepartmentLead(
      memberId,
      departmentId,
      DepartmentLeadTypeEnum.HOD,
    );
    await this.assertGoalWritable(cycle, departmentId);
    const goal = await this.getGoalOrThrow(cycleId, goalId, departmentId);
    this.assertNotFrozen(goal);

    await this.goalRepo.remove(goal);
    this.auditLogService.log('DEPARTMENT_GOAL_DELETED', {
      actorId: memberId,
      targetId: goalId,
      targetName: goal.title,
      metadata: { cycleId, departmentId },
    });
    if (cycle.approvalChain?.length) {
      await this.approvalService.onHodGoalWrite(cycle, departmentId, memberId);
    }
  }

  async submitSelfRating(
    cycleId: string,
    departmentId: string,
    goalId: string,
    dto: SubmitRatingDto,
    memberId: string,
  ): Promise<DepartmentGoal> {
    const cycle = await this.getCycleOrThrow(cycleId);
    await this.departmentService.assertIsDepartmentLead(
      memberId,
      departmentId,
      DepartmentLeadTypeEnum.HOD,
    );
    if (this.getEffectiveStage(cycle) !== GoalCycleStage.REVIEWED) {
      throw new BadRequestException(
        'Self-ratings can only be submitted once the cycle has ended.',
      );
    }
    await this.assertApprovalComplete(cycle, departmentId);
    const goal = await this.getGoalOrThrow(cycleId, goalId, departmentId);
    if (goal.selfRating !== null) {
      throw new BadRequestException('You have already rated this goal.');
    }

    goal.selfRating = dto.rating;
    goal.selfRatingReason = dto.reason;
    goal.selfRatedAt = new Date();
    goal.selfRatedByMember = { id: memberId } as Member;
    const saved = await this.goalRepo.save(goal);

    this.auditLogService.log('DEPARTMENT_GOAL_SELF_RATED', {
      actorId: memberId,
      targetId: goalId,
      targetName: saved.title,
      metadata: { cycleId, departmentId },
    });
    return saved;
  }

  // Read-only, HOD or Deputy-HOD of the goal's own department — "the HOD can
  // see that history... not discover secondhand" per the source doc.
  async getGoalHistory(
    cycleId: string,
    departmentId: string,
    goalId: string,
    memberId: string,
  ) {
    await this.getCycleOrThrow(cycleId);
    await this.departmentService.assertIsDepartmentLead(memberId, departmentId);
    await this.getGoalOrThrow(cycleId, goalId, departmentId);
    return this.getCorrectionHistory(goalId);
  }

  // Admin-facing equivalent of getGoalHistory above — existence check only,
  // no HOD-lead gate, since any admin with DEPARTMENT_GOALS_READ should be
  // able to see what another admin changed directly on a goal.
  async getGoalHistoryForAdmin(cycleId: string, goalId: string) {
    await this.getGoalOrThrow(cycleId, goalId);
    return this.getCorrectionHistory(goalId);
  }

  private async getCorrectionHistory(goalId: string) {
    const { data } = await this.auditLogService.findAll(1, 100, {
      targetId: goalId,
      action: 'DEPARTMENT_GOAL_CORRECTED',
    });
    return data;
  }

  async generatePdf(
    cycleId: string,
    departmentId: string,
    memberId: string,
  ): Promise<Buffer> {
    const cycle = await this.getCycleOrThrow(cycleId);
    const lead = await this.departmentService.assertIsDepartmentLead(
      memberId,
      departmentId,
      DepartmentLeadTypeEnum.HOD,
    );
    const stage = this.getEffectiveStage(cycle);
    const goals = await this.goalRepo.find({
      where: { cycle: { id: cycleId }, department: { id: departmentId } },
      order: { createdAt: 'ASC' },
    });

    return this.pdfService.generateDepartmentGoalReport({
      departmentName: lead.department.name,
      cycleName: cycle.name,
      stage,
      goals: goals.map((g) => this.toGoalView(g)),
    });
  }

  private async getGoalOrThrow(
    cycleId: string,
    goalId: string,
    departmentId?: string,
  ): Promise<DepartmentGoal> {
    const goal = await this.goalRepo.findOne({
      where: { id: goalId, cycle: { id: cycleId } },
      relations: ['department'],
    });
    if (!goal) throw new NotFoundException('Goal not found');
    if (departmentId && goal.department.id !== departmentId) {
      throw new NotFoundException('Goal not found');
    }
    return goal;
  }

  private assertNotFrozen(goal: DepartmentGoal): void {
    if (goal.churchRating !== null || goal.selfRating !== null) {
      throw new BadRequestException(
        'This goal has already been rated and can no longer be changed.',
      );
    }
  }

  // Replaces the old flat "only while OPENING" check. A cycle with no
  // approval chain configured behaves exactly as before — only the branch
  // this method is new for is a chain-gated cycle, where the HOD keeps
  // write access at ANY stage until their department's chain completes
  // (including after a level requests changes, past the OPENING window).
  private async assertGoalWritable(
    cycle: DepartmentGoalCycle,
    departmentId: string,
  ): Promise<void> {
    if (this.getEffectiveStage(cycle) === GoalCycleStage.INACTIVE) {
      throw new BadRequestException('This goal cycle has been deactivated.');
    }
    if (cycle.approvalChain?.length) {
      if (await this.approvalService.isApprovalComplete(cycle, departmentId)) {
        throw new BadRequestException(
          "This department's goals have been fully approved and can no longer be edited.",
        );
      }
      return;
    }
    if (this.getEffectiveStage(cycle) !== GoalCycleStage.OPENING) {
      throw new BadRequestException(
        'Goals can only be added, edited, or removed while the cycle is open.',
      );
    }
  }

  private async assertApprovalComplete(
    cycle: DepartmentGoalCycle,
    departmentId: string,
  ): Promise<void> {
    if (!cycle.approvalChain?.length) return;
    if (!(await this.approvalService.isApprovalComplete(cycle, departmentId))) {
      throw new BadRequestException(
        "This department's goals must complete the approval chain before ratings can be submitted.",
      );
    }
  }

  private assertValidDateRange(
    startDate: string,
    graceDeadline: string,
    endDate: string,
  ): void {
    if (!(startDate <= graceDeadline && graceDeadline <= endDate)) {
      throw new BadRequestException(
        'Dates must satisfy startDate <= graceDeadline <= endDate',
      );
    }
  }

  // Server-side blind-until-both-in enforcement — a goal's ratings are only
  // ever returned once BOTH are set, regardless of who's asking, matching
  // "neither sees the other's score until both are in." The HOD's own
  // just-submitted rating is confirmed to them via the submit response
  // itself, not by this endpoint reflecting it back early.
  private toGoalView(g: DepartmentGoal): GoalView {
    const revealed = g.churchRating !== null && g.selfRating !== null;
    return {
      id: g.id,
      title: g.title,
      description: g.description,
      timelineToAchieve: g.timelineToAchieve,
      churchRating: revealed ? g.churchRating : null,
      churchRatingReason: revealed ? g.churchRatingReason : null,
      selfRating: revealed ? g.selfRating : null,
      selfRatingReason: revealed ? g.selfRatingReason : null,
    };
  }
}
