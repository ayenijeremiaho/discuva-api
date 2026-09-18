import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DepartmentGoalService } from './department-goal.service';
import { DepartmentGoalCycle } from '../entity/department-goal-cycle.entity';
import { DepartmentGoal } from '../entity/department-goal.entity';
import { GoalCycleStage } from '../enum/goal-cycle-stage.enum';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { DepartmentService } from '../../department/service/department.service';
import { DepartmentLeadTypeEnum } from '../../department/enums/department-lead-type.enum';
import { DateService } from '../../utility/service/date.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { PdfService } from '../../utility/service/pdf.service';
import { Admin } from '../../admin/entity/admin.entity';
import { DepartmentGoalApprovalService } from './department-goal-approval.service';

const mockCycleRepo = {
  create: jest.fn((v) => v),
  save: jest.fn((v) => Promise.resolve({ id: 'cycle-1', ...v })),
  find: jest.fn(),
  findOne: jest.fn(),
  findOneBy: jest.fn(),
};
const mockGoalRepo = {
  create: jest.fn((v) => v),
  save: jest.fn((v) => Promise.resolve({ id: 'goal-1', ...v })),
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn(),
  remove: jest.fn(),
  createQueryBuilder: jest.fn(),
};
const mockWorkerProfileRepo = {
  findOne: jest.fn().mockResolvedValue(null),
};
const mockDepartmentService = {
  assertIsDepartmentLead: jest.fn(),
  getLeadRoles: jest.fn().mockResolvedValue([]),
};
const mockDateService = {
  today: jest.fn().mockReturnValue('2026-06-15'),
};
const mockAuditLogService = {
  log: jest.fn(),
  findAll: jest.fn().mockResolvedValue({ data: [] }),
};
const mockPdfService = {
  generateDepartmentGoalReport: jest.fn().mockResolvedValue(Buffer.from('pdf')),
};
const mockApprovalService = {
  validateChain: jest.fn().mockResolvedValue(undefined),
  assertChainMutable: jest.fn().mockResolvedValue(undefined),
  isApprovalComplete: jest.fn().mockResolvedValue(false),
  onHodGoalWrite: jest.fn().mockResolvedValue(undefined),
};

const admin = { id: 'admin-1', member: { id: 'member-admin-1' } } as Admin;

function makeCycle(
  overrides: Partial<DepartmentGoalCycle> = {},
): DepartmentGoalCycle {
  return {
    id: 'cycle-1',
    name: 'Q3 2026 Goals',
    startDate: '2026-06-01',
    graceDeadline: '2026-06-14',
    endDate: '2026-06-30',
    isActive: true,
    approvalChain: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('DepartmentGoalService', () => {
  let service: DepartmentGoalService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDateService.today.mockReturnValue('2026-06-15');
    mockDepartmentService.getLeadRoles.mockResolvedValue([]);
    mockWorkerProfileRepo.findOne.mockResolvedValue(null);
    mockGoalRepo.find.mockResolvedValue([]);
    mockAuditLogService.findAll.mockResolvedValue({ data: [] });
    mockApprovalService.isApprovalComplete.mockResolvedValue(false);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepartmentGoalService,
        {
          provide: getRepositoryToken(DepartmentGoalCycle),
          useValue: mockCycleRepo,
        },
        { provide: getRepositoryToken(DepartmentGoal), useValue: mockGoalRepo },
        {
          provide: getRepositoryToken(WorkerProfile),
          useValue: mockWorkerProfileRepo,
        },
        { provide: DepartmentService, useValue: mockDepartmentService },
        { provide: DateService, useValue: mockDateService },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: PdfService, useValue: mockPdfService },
        {
          provide: DepartmentGoalApprovalService,
          useValue: mockApprovalService,
        },
      ],
    }).compile();
    service = module.get(DepartmentGoalService);
  });

  describe('getEffectiveStage', () => {
    it('is OPENING before the grace deadline', () => {
      expect(service.getEffectiveStage(makeCycle(), '2026-06-10')).toBe(
        GoalCycleStage.OPENING,
      );
    });

    it('is IN_PROGRESS between the grace deadline and endDate', () => {
      expect(service.getEffectiveStage(makeCycle(), '2026-06-20')).toBe(
        GoalCycleStage.IN_PROGRESS,
      );
    });

    it('is REVIEWED on/after endDate', () => {
      expect(service.getEffectiveStage(makeCycle(), '2026-06-30')).toBe(
        GoalCycleStage.REVIEWED,
      );
      expect(service.getEffectiveStage(makeCycle(), '2026-07-05')).toBe(
        GoalCycleStage.REVIEWED,
      );
    });

    it('is INACTIVE when the cycle is deactivated, even during what would otherwise be OPENING — not falling through to a date-derived stage', () => {
      expect(
        service.getEffectiveStage(makeCycle({ isActive: false }), '2026-06-10'),
      ).toBe(GoalCycleStage.INACTIVE);
    });

    it('stays INACTIVE even past endDate — deactivation always wins over dates', () => {
      expect(
        service.getEffectiveStage(makeCycle({ isActive: false }), '2026-07-05'),
      ).toBe(GoalCycleStage.INACTIVE);
    });
  });

  describe('createCycle', () => {
    it('rejects graceDeadline before startDate', async () => {
      await expect(
        service.createCycle(
          {
            name: 'Bad',
            startDate: '2026-06-10',
            graceDeadline: '2026-06-05',
            endDate: '2026-06-30',
          },
          admin,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects endDate before graceDeadline', async () => {
      await expect(
        service.createCycle(
          {
            name: 'Bad',
            startDate: '2026-06-01',
            graceDeadline: '2026-06-20',
            endDate: '2026-06-10',
          },
          admin,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a valid cycle and audit-logs it', async () => {
      const result = await service.createCycle(
        {
          name: 'Q3 2026 Goals',
          startDate: '2026-06-01',
          graceDeadline: '2026-06-14',
          endDate: '2026-06-30',
        },
        admin,
      );
      expect(result.id).toBe('cycle-1');
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'DEPARTMENT_GOAL_CYCLE_CREATED',
        expect.objectContaining({ actorId: 'admin-1' }),
      );
    });
  });

  describe('updateCycle', () => {
    it('re-validates the date range when moving the grace deadline — the "movable anytime" path is not exempt from the check', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(makeCycle());
      await expect(
        service.updateCycle('cycle-1', { graceDeadline: '2026-07-15' }, admin),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows a graceDeadline move that still satisfies the ordering', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(makeCycle());
      const result = await service.updateCycle(
        'cycle-1',
        { graceDeadline: '2026-06-20' },
        admin,
      );
      expect(result.graceDeadline).toBe('2026-06-20');
    });
  });

  describe('goal freeze rule', () => {
    it('rejects an HOD edit once either rating has been submitted', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(
        makeCycle({ graceDeadline: '2026-12-01' }),
      );
      mockDepartmentService.assertIsDepartmentLead.mockResolvedValue({});
      mockGoalRepo.findOne.mockResolvedValue({
        id: 'goal-1',
        title: 'Old title',
        churchRating: null,
        selfRating: 4,
        department: { id: 'dept-1' },
      });

      await expect(
        service.updateGoalAsHod(
          'cycle-1',
          'dept-1',
          'goal-1',
          { title: 'New title' },
          'member-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects deleting a frozen goal', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(
        makeCycle({ graceDeadline: '2026-12-01' }),
      );
      mockDepartmentService.assertIsDepartmentLead.mockResolvedValue({});
      mockGoalRepo.findOne.mockResolvedValue({
        id: 'goal-1',
        title: 'Goal',
        churchRating: 5,
        selfRating: null,
        department: { id: 'dept-1' },
      });

      await expect(
        service.deleteGoalAsHod('cycle-1', 'dept-1', 'goal-1', 'member-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('stage-gated writes', () => {
    it('rejects creating a goal once the cycle has left OPENING', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(makeCycle());
      mockDepartmentService.assertIsDepartmentLead.mockResolvedValue({});
      await expect(
        service.createGoal(
          'cycle-1',
          'dept-1',
          { title: 'New goal' },
          'member-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a non-HOD department lead (e.g. Deputy-HOD) from creating a goal — assertIsDepartmentLead is called with HOD specifically', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(
        makeCycle({ graceDeadline: '2026-12-01' }),
      );
      mockDepartmentService.assertIsDepartmentLead.mockRejectedValue(
        new ForbiddenException('You are not a lead of this department.'),
      );
      await expect(
        service.createGoal(
          'cycle-1',
          'dept-1',
          { title: 'New goal' },
          'member-1',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(mockDepartmentService.assertIsDepartmentLead).toHaveBeenCalledWith(
        'member-1',
        'dept-1',
        DepartmentLeadTypeEnum.HOD,
      );
    });

    it('rejects a church correction outside IN_PROGRESS', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(
        makeCycle({ graceDeadline: '2026-12-01' }),
      ); // still OPENING
      await expect(
        service.correctGoal('cycle-1', 'goal-1', { title: 'Fixed' }, admin),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a self-rating before REVIEWED', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(
        makeCycle({ graceDeadline: '2026-12-01' }),
      );
      mockDepartmentService.assertIsDepartmentLead.mockResolvedValue({});
      await expect(
        service.submitSelfRating(
          'cycle-1',
          'dept-1',
          'goal-1',
          { rating: 4, reason: 'Good progress' },
          'member-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('timelineToAchieve ("Timeline to Achieve Target")', () => {
    it('is persisted on create', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(
        makeCycle({ graceDeadline: '2026-12-01' }),
      );
      mockDepartmentService.assertIsDepartmentLead.mockResolvedValue({});

      const result = await service.createGoal(
        'cycle-1',
        'dept-1',
        { title: 'Grow the choir', timelineToAchieve: 'Q3 2026' },
        'member-1',
      );
      expect(result.timelineToAchieve).toBe('Q3 2026');
    });

    it('defaults to null on create when omitted', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(
        makeCycle({ graceDeadline: '2026-12-01' }),
      );
      mockDepartmentService.assertIsDepartmentLead.mockResolvedValue({});

      const result = await service.createGoal(
        'cycle-1',
        'dept-1',
        { title: 'Grow the choir' },
        'member-1',
      );
      expect(result.timelineToAchieve).toBeNull();
    });

    it('is updated by the HOD alongside title/description', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(
        makeCycle({ graceDeadline: '2026-12-01' }),
      );
      mockDepartmentService.assertIsDepartmentLead.mockResolvedValue({});
      mockGoalRepo.findOne.mockResolvedValue({
        id: 'goal-1',
        title: 'Old title',
        timelineToAchieve: 'Q1 2026',
        churchRating: null,
        selfRating: null,
        department: { id: 'dept-1' },
      });

      const result = await service.updateGoalAsHod(
        'cycle-1',
        'dept-1',
        'goal-1',
        { timelineToAchieve: 'By end of cycle' },
        'member-1',
      );
      expect(result.timelineToAchieve).toBe('By end of cycle');
    });

    it('is updated via an admin correction, and included in the audit before/after', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(
        makeCycle({ graceDeadline: '2026-06-01' }), // IN_PROGRESS
      );
      mockGoalRepo.findOne.mockResolvedValue({
        id: 'goal-1',
        title: 'Grow the choir',
        description: null,
        timelineToAchieve: 'Q1 2026',
        churchRating: null,
        selfRating: null,
        department: { id: 'dept-1' },
      });

      const result = await service.correctGoal(
        'cycle-1',
        'goal-1',
        { timelineToAchieve: 'Q4 2026' },
        admin,
      );
      expect(result.timelineToAchieve).toBe('Q4 2026');
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'DEPARTMENT_GOAL_CORRECTED',
        expect.objectContaining({
          metadata: expect.objectContaining({
            before: expect.objectContaining({ timelineToAchieve: 'Q1 2026' }),
            after: expect.objectContaining({ timelineToAchieve: 'Q4 2026' }),
          }),
        }),
      );
    });
  });

  describe('write-once ratings', () => {
    it('rejects a second church rating on the same goal', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(
        makeCycle({ endDate: '2026-06-01' }),
      ); // REVIEWED
      mockGoalRepo.findOne.mockResolvedValue({
        id: 'goal-1',
        title: 'Goal',
        churchRating: 3,
        department: { id: 'dept-1' },
      });
      await expect(
        service.submitChurchRating(
          'cycle-1',
          'goal-1',
          { rating: 5, reason: 'Great' },
          admin,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a second self-rating on the same goal', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(
        makeCycle({ endDate: '2026-06-01' }),
      ); // REVIEWED
      mockDepartmentService.assertIsDepartmentLead.mockResolvedValue({});
      mockGoalRepo.findOne.mockResolvedValue({
        id: 'goal-1',
        title: 'Goal',
        selfRating: 4,
        department: { id: 'dept-1' },
      });
      await expect(
        service.submitSelfRating(
          'cycle-1',
          'dept-1',
          'goal-1',
          { rating: 5, reason: 'Great' },
          'member-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a first-time self-rating', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(
        makeCycle({ endDate: '2026-06-01' }),
      ); // REVIEWED
      mockDepartmentService.assertIsDepartmentLead.mockResolvedValue({});
      mockGoalRepo.findOne.mockResolvedValue({
        id: 'goal-1',
        title: 'Goal',
        selfRating: null,
        department: { id: 'dept-1' },
      });
      const result = await service.submitSelfRating(
        'cycle-1',
        'dept-1',
        'goal-1',
        { rating: 4, reason: 'Good progress' },
        'member-1',
      );
      expect(result.selfRating).toBe(4);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'DEPARTMENT_GOAL_SELF_RATED',
        expect.objectContaining({ actorId: 'member-1', targetId: 'goal-1' }),
      );
    });
  });

  describe('getCurrentForMember', () => {
    it('returns an empty response when there is no active cycle', async () => {
      mockCycleRepo.findOne.mockResolvedValue(null);
      const result = await service.getCurrentForMember('member-1');
      expect(result).toEqual({ cycle: null, departments: [] });
    });

    it('reports hasApprovalChain: false when the cycle has no approval chain configured', async () => {
      mockCycleRepo.findOne.mockResolvedValue(makeCycle());
      mockDepartmentService.getLeadRoles.mockResolvedValue([]);
      mockWorkerProfileRepo.findOne.mockResolvedValue(null);

      const result = await service.getCurrentForMember('member-1');
      expect(result.cycle?.hasApprovalChain).toBe(false);
    });

    it('reports hasApprovalChain: true when the cycle has one configured — so the member UI can avoid promising review starts exactly at endDate', async () => {
      mockCycleRepo.findOne.mockResolvedValue(
        makeCycle({ approvalChain: [{ level: 1, adminId: 'admin-1' }] }),
      );
      mockDepartmentService.getLeadRoles.mockResolvedValue([]);
      mockWorkerProfileRepo.findOne.mockResolvedValue(null);

      const result = await service.getCurrentForMember('member-1');
      expect(result.cycle?.hasApprovalChain).toBe(true);
    });

    it('withholds goals from a plain department member while the cycle is still OPENING', async () => {
      mockCycleRepo.findOne.mockResolvedValue(makeCycle()); // OPENING at today=2026-06-15... wait grace is 06-14, so this is IN_PROGRESS by default; override below
      mockCycleRepo.findOne.mockResolvedValue(
        makeCycle({ graceDeadline: '2026-12-01' }), // still OPENING
      );
      mockDepartmentService.getLeadRoles.mockResolvedValue([]);
      mockWorkerProfileRepo.findOne.mockResolvedValue({
        department: { id: 'dept-1', name: 'Ushering' },
        secondaryDepartment: null,
      });

      const result = await service.getCurrentForMember('member-1');
      expect(result.departments).toEqual([
        {
          departmentId: 'dept-1',
          departmentName: 'Ushering',
          role: 'MEMBER',
          goals: null,
        },
      ]);
    });

    it('shows a plain department member the goal list once the cycle has locked (IN_PROGRESS)', async () => {
      mockCycleRepo.findOne.mockResolvedValue(makeCycle()); // today 2026-06-15, grace 06-14 → IN_PROGRESS
      mockDepartmentService.getLeadRoles.mockResolvedValue([]);
      mockWorkerProfileRepo.findOne.mockResolvedValue({
        department: { id: 'dept-1', name: 'Ushering' },
        secondaryDepartment: null,
      });
      mockGoalRepo.find.mockResolvedValue([
        {
          id: 'goal-1',
          title: 'Greet every visitor',
          description: null,
          churchRating: null,
          churchRatingReason: null,
          selfRating: null,
          selfRatingReason: null,
        },
      ]);

      const result = await service.getCurrentForMember('member-1');
      expect(result.departments[0].goals).toHaveLength(1);
      expect(result.departments[0].goals?.[0].title).toBe(
        'Greet every visitor',
      );
    });

    it('shows the HOD goals live even while still OPENING — the Deputy-HOD/HOD "from day one" rule', async () => {
      mockCycleRepo.findOne.mockResolvedValue(
        makeCycle({ graceDeadline: '2026-12-01' }),
      ); // OPENING
      mockDepartmentService.getLeadRoles.mockResolvedValue([
        {
          departmentId: 'dept-1',
          departmentName: 'Ushering',
          leadType: DepartmentLeadTypeEnum.HOD,
        },
      ]);
      mockWorkerProfileRepo.findOne.mockResolvedValue({
        // Deliberately a DIFFERENT department than the one they lead — the
        // exact Deputy/HOD department-resolution bug the design review
        // caught: department must resolve via DepartmentLead, not
        // WorkerProfile, for a lead role.
        department: { id: 'dept-2', name: 'Media' },
        secondaryDepartment: null,
      });
      mockGoalRepo.find.mockResolvedValue([
        {
          id: 'goal-1',
          title: 'Draft goal',
          description: null,
          churchRating: null,
          churchRatingReason: null,
          selfRating: null,
          selfRatingReason: null,
        },
      ]);

      const result = await service.getCurrentForMember('member-1');
      const ushering = result.departments.find(
        (d) => d.departmentId === 'dept-1',
      );
      expect(ushering?.role).toBe('HOD');
      expect(ushering?.goals).toHaveLength(1);
      // The member's own (different) primary department still shows too,
      // correctly withheld since they're only a plain member there.
      const media = result.departments.find((d) => d.departmentId === 'dept-2');
      expect(media?.role).toBe('MEMBER');
      expect(media?.goals).toBeNull();
    });

    it('nulls out both ratings unless both are set — blind until both are in, regardless of role', async () => {
      mockCycleRepo.findOne.mockResolvedValue(
        makeCycle({ endDate: '2026-06-01' }),
      ); // REVIEWED
      mockDepartmentService.getLeadRoles.mockResolvedValue([
        {
          departmentId: 'dept-1',
          departmentName: 'Ushering',
          leadType: DepartmentLeadTypeEnum.HOD,
        },
      ]);
      mockWorkerProfileRepo.findOne.mockResolvedValue(null);
      mockGoalRepo.find.mockResolvedValue([
        {
          id: 'goal-1',
          title: 'One-sided so far',
          description: null,
          churchRating: null,
          churchRatingReason: null,
          selfRating: 4,
          selfRatingReason: 'Did well',
        },
        {
          id: 'goal-2',
          title: 'Both in',
          description: null,
          churchRating: 5,
          churchRatingReason: 'Excellent',
          selfRating: 4,
          selfRatingReason: 'Did well',
        },
      ]);

      const result = await service.getCurrentForMember('member-1');
      const goals = result.departments[0].goals!;
      expect(goals[0].selfRating).toBeNull();
      expect(goals[0].churchRating).toBeNull();
      expect(goals[1].selfRating).toBe(4);
      expect(goals[1].churchRating).toBe(5);
    });
  });

  describe('getReport', () => {
    it('computes avg self/church score and the gap per department', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(makeCycle());
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            departmentId: 'dept-1',
            departmentName: 'Ushering',
            avgSelfScore: '4.50',
            avgChurchScore: '3.00',
          },
          {
            departmentId: 'dept-2',
            departmentName: 'Media',
            avgSelfScore: null,
            avgChurchScore: null,
          },
        ]),
      };
      mockGoalRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getReport('cycle-1');
      expect(result[0]).toEqual({
        departmentId: 'dept-1',
        departmentName: 'Ushering',
        avgSelfScore: 4.5,
        avgChurchScore: 3,
        gap: 1.5,
      });
      expect(result[1].gap).toBeNull();
    });
  });

  describe('approval-chain-gated cycles', () => {
    const chainCycle = makeCycle({
      graceDeadline: '2026-06-14', // past — would normally lock writes
      approvalChain: [{ level: 1, adminId: 'approver-1' }],
    });

    it('lets the HOD edit a goal past OPENING when the department approval is not yet complete', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(chainCycle);
      mockDepartmentService.assertIsDepartmentLead.mockResolvedValue({});
      mockApprovalService.isApprovalComplete.mockResolvedValue(false);
      mockGoalRepo.findOne.mockResolvedValue({
        id: 'goal-1',
        title: 'Old title',
        churchRating: null,
        selfRating: null,
        department: { id: 'dept-1' },
      });

      const result = await service.updateGoalAsHod(
        'cycle-1',
        'dept-1',
        'goal-1',
        { title: 'New title' },
        'member-1',
      );
      expect(result.title).toBe('New title');
      expect(mockApprovalService.onHodGoalWrite).toHaveBeenCalledWith(
        chainCycle,
        'dept-1',
        'member-1',
      );
    });

    it('blocks the HOD from editing once the department approval is COMPLETE, even mid-cycle', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(chainCycle);
      mockDepartmentService.assertIsDepartmentLead.mockResolvedValue({});
      mockApprovalService.isApprovalComplete.mockResolvedValue(true);

      await expect(
        service.updateGoalAsHod(
          'cycle-1',
          'dept-1',
          'goal-1',
          { title: 'New title' },
          'member-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('a cycle with no approvalChain still locks HOD writes outside OPENING — unchanged backward-compatible behavior', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(
        makeCycle({ graceDeadline: '2026-06-14', approvalChain: null }),
      );
      mockDepartmentService.assertIsDepartmentLead.mockResolvedValue({});

      await expect(
        service.updateGoalAsHod(
          'cycle-1',
          'dept-1',
          'goal-1',
          { title: 'New title' },
          'member-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockApprovalService.onHodGoalWrite).not.toHaveBeenCalled();
    });

    it('blocks church rating until the department approval is complete, even when the cycle is REVIEWED', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(
        makeCycle({
          endDate: '2026-06-01', // REVIEWED
          approvalChain: [{ level: 1, adminId: 'approver-1' }],
        }),
      );
      mockApprovalService.isApprovalComplete.mockResolvedValue(false);
      mockGoalRepo.findOne.mockResolvedValue({
        id: 'goal-1',
        title: 'Goal',
        churchRating: null,
        department: { id: 'dept-1' },
      });

      await expect(
        service.submitChurchRating(
          'cycle-1',
          'goal-1',
          { rating: 5, reason: 'Great' },
          admin,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows church rating once the department approval is complete', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(
        makeCycle({
          endDate: '2026-06-01', // REVIEWED
          approvalChain: [{ level: 1, adminId: 'approver-1' }],
        }),
      );
      mockApprovalService.isApprovalComplete.mockResolvedValue(true);
      mockGoalRepo.findOne.mockResolvedValue({
        id: 'goal-1',
        title: 'Goal',
        churchRating: null,
        department: { id: 'dept-1' },
      });

      const result = await service.submitChurchRating(
        'cycle-1',
        'goal-1',
        { rating: 5, reason: 'Great' },
        admin,
      );
      expect(result.churchRating).toBe(5);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'DEPARTMENT_GOAL_CHURCH_RATED',
        expect.objectContaining({ actorId: 'member-admin-1' }),
      );
    });

    it('blocks self-rating until the department approval is complete', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(
        makeCycle({
          endDate: '2026-06-01', // REVIEWED
          approvalChain: [{ level: 1, adminId: 'approver-1' }],
        }),
      );
      mockDepartmentService.assertIsDepartmentLead.mockResolvedValue({});
      mockApprovalService.isApprovalComplete.mockResolvedValue(false);

      await expect(
        service.submitSelfRating(
          'cycle-1',
          'dept-1',
          'goal-1',
          { rating: 4, reason: 'Good progress' },
          'member-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('a rating still cannot be submitted before REVIEWED, chain or no chain', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(
        makeCycle({
          graceDeadline: '2026-12-01', // still OPENING
          approvalChain: [{ level: 1, adminId: 'approver-1' }],
        }),
      );
      mockApprovalService.isApprovalComplete.mockResolvedValue(true);
      await expect(
        service.submitChurchRating(
          'cycle-1',
          'goal-1',
          { rating: 5, reason: 'Great' },
          admin,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('correctGoal audit actor', () => {
    it("logs actorId as the admin's member id, not the admin id", async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(
        makeCycle({ graceDeadline: '2026-06-01', endDate: '2026-12-01' }),
      ); // IN_PROGRESS
      mockGoalRepo.findOne.mockResolvedValue({
        id: 'goal-1',
        title: 'Old title',
        description: null,
        churchRating: null,
        selfRating: null,
        department: { id: 'dept-1' },
      });

      await service.correctGoal(
        'cycle-1',
        'goal-1',
        { title: 'New title' },
        admin,
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'DEPARTMENT_GOAL_CORRECTED',
        expect.objectContaining({ actorId: 'member-admin-1' }),
      );
    });
  });

  describe('getGoalHistoryForAdmin', () => {
    it('returns correction history without requiring the caller to be a department lead', async () => {
      mockGoalRepo.findOne.mockResolvedValue({
        id: 'goal-1',
        department: { id: 'dept-1' },
      });
      mockAuditLogService.findAll.mockResolvedValue({
        data: [{ action: 'DEPARTMENT_GOAL_CORRECTED' }],
      });

      const result = await service.getGoalHistoryForAdmin('cycle-1', 'goal-1');
      expect(result).toHaveLength(1);
      expect(
        mockDepartmentService.assertIsDepartmentLead,
      ).not.toHaveBeenCalled();
      expect(mockAuditLogService.findAll).toHaveBeenCalledWith(
        1,
        100,
        expect.objectContaining({
          targetId: 'goal-1',
          action: 'DEPARTMENT_GOAL_CORRECTED',
        }),
      );
    });
  });
});
