import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DepartmentGoalApprovalService } from './department-goal-approval.service';
import { DepartmentGoalCycle } from '../entity/department-goal-cycle.entity';
import { DepartmentGoalApproval } from '../entity/department-goal-approval.entity';
import { DepartmentGoalComment } from '../entity/department-goal-comment.entity';
import { DepartmentGoalApprovalStatus } from '../enum/department-goal-approval-status.enum';
import { AdminService } from '../../admin/service/admin.service';
import { DepartmentService } from '../../department/service/department.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { Admin } from '../../admin/entity/admin.entity';

const mockCycleRepo = {
  findOneBy: jest.fn(),
};
const mockApprovalRepo = {
  create: jest.fn((v) => v),
  save: jest.fn((v) => Promise.resolve({ id: 'approval-1', ...v })),
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn(),
};
const mockCommentRepo = {
  create: jest.fn((v) => v),
  save: jest.fn((v) => Promise.resolve({ id: 'comment-1', ...v })),
  find: jest.fn().mockResolvedValue([]),
};
const mockAdminService = {
  findById: jest.fn(),
  getAll: jest.fn().mockResolvedValue([]),
};
const mockDepartmentService = {
  getDepartmentLeads: jest.fn(),
  assertIsDepartmentLead: jest.fn(),
};
const mockAuditLogService = {
  log: jest.fn(),
};
const mockNotificationDispatchService = {
  notifyMember: jest.fn().mockResolvedValue(undefined),
};

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
    approvalChain: [
      { level: 1, adminId: 'approver-1' },
      { level: 2, adminId: 'approver-2' },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeApprover(id: string): Admin {
  return {
    id,
    member: { id: `member-${id}`, firstname: 'A', lastname: 'B' },
    isActive: true,
  } as Admin;
}

const noLeads = { name: 'Ushering', head: null, assistant: null };

describe('DepartmentGoalApprovalService', () => {
  let service: DepartmentGoalApprovalService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockApprovalRepo.find.mockResolvedValue([]);
    mockApprovalRepo.findOne.mockResolvedValue(null);
    mockCommentRepo.find.mockResolvedValue([]);
    mockDepartmentService.getDepartmentLeads.mockResolvedValue(noLeads);
    mockAdminService.findById.mockImplementation((id: string) =>
      Promise.resolve(makeApprover(id)),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepartmentGoalApprovalService,
        {
          provide: getRepositoryToken(DepartmentGoalCycle),
          useValue: mockCycleRepo,
        },
        {
          provide: getRepositoryToken(DepartmentGoalApproval),
          useValue: mockApprovalRepo,
        },
        {
          provide: getRepositoryToken(DepartmentGoalComment),
          useValue: mockCommentRepo,
        },
        { provide: AdminService, useValue: mockAdminService },
        { provide: DepartmentService, useValue: mockDepartmentService },
        { provide: AuditLogService, useValue: mockAuditLogService },
        {
          provide: NotificationDispatchService,
          useValue: mockNotificationDispatchService,
        },
      ],
    }).compile();
    service = module.get(DepartmentGoalApprovalService);
  });

  describe('validateChain', () => {
    it('no-ops for null/undefined/empty', async () => {
      await expect(service.validateChain(null)).resolves.toBeUndefined();
      await expect(service.validateChain(undefined)).resolves.toBeUndefined();
      await expect(service.validateChain([])).resolves.toBeUndefined();
    });

    it('rejects more than 3 levels', async () => {
      await expect(
        service.validateChain([
          { level: 1, adminId: 'a' },
          { level: 2, adminId: 'b' },
          { level: 3, adminId: 'c' },
          { level: 4, adminId: 'd' },
        ]),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects non-contiguous levels', async () => {
      await expect(
        service.validateChain([
          { level: 1, adminId: 'a' },
          { level: 3, adminId: 'b' },
        ]),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects the same admin assigned to more than one level', async () => {
      await expect(
        service.validateChain([
          { level: 1, adminId: 'a' },
          { level: 2, adminId: 'a' },
        ]),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an inactive admin', async () => {
      mockAdminService.findById.mockResolvedValue({
        id: 'a',
        isActive: false,
      } as Admin);
      await expect(
        service.validateChain([{ level: 1, adminId: 'a' }]),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an admin id that does not resolve', async () => {
      mockAdminService.findById.mockRejectedValue(new Error('not found'));
      await expect(
        service.validateChain([{ level: 1, adminId: 'a' }]),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a valid 1-3 contiguous chain of distinct active admins', async () => {
      await expect(
        service.validateChain([
          { level: 1, adminId: 'a' },
          { level: 2, adminId: 'b' },
        ]),
      ).resolves.toBeUndefined();
    });
  });

  describe('assertChainMutable', () => {
    it('allows reassigning an admin on an existing level even after progress', async () => {
      mockApprovalRepo.find.mockResolvedValue([
        { currentLevel: 2, status: DepartmentGoalApprovalStatus.PENDING },
      ]);
      await expect(
        service.assertChainMutable(
          'cycle-1',
          [{ level: 1, adminId: 'old' }],
          [{ level: 1, adminId: 'new' }],
        ),
      ).resolves.toBeUndefined();
    });

    it('allows a structural change when nothing has progressed yet', async () => {
      mockApprovalRepo.find.mockResolvedValue([]);
      await expect(
        service.assertChainMutable(
          'cycle-1',
          [{ level: 1, adminId: 'a' }],
          [
            { level: 1, adminId: 'a' },
            { level: 2, adminId: 'b' },
          ],
        ),
      ).resolves.toBeUndefined();
    });

    it('blocks a structural change once any department has progressed', async () => {
      mockApprovalRepo.find.mockResolvedValue([
        { currentLevel: 2, status: DepartmentGoalApprovalStatus.PENDING },
      ]);
      await expect(
        service.assertChainMutable(
          'cycle-1',
          [{ level: 1, adminId: 'a' }],
          [
            { level: 1, adminId: 'a' },
            { level: 2, adminId: 'b' },
          ],
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getOrCreateApproval', () => {
    it('creates a row only once — a second call reuses the existing row', async () => {
      mockApprovalRepo.findOne.mockResolvedValueOnce(null);
      const first = await service.getOrCreateApproval(makeCycle(), 'dept-1');
      expect(mockApprovalRepo.save).toHaveBeenCalledTimes(1);

      mockApprovalRepo.findOne.mockResolvedValueOnce(first);
      await service.getOrCreateApproval(makeCycle(), 'dept-1');
      expect(mockApprovalRepo.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('decide', () => {
    const leads = {
      name: 'Ushering',
      head: { member: { id: 'hod-member-1' } },
      assistant: null,
    };

    beforeEach(() => {
      mockCycleRepo.findOneBy.mockResolvedValue(makeCycle());
      mockDepartmentService.getDepartmentLeads.mockResolvedValue(leads);
    });

    it('rejects when the cycle has no approval chain configured', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(
        makeCycle({ approvalChain: null }),
      );
      await expect(
        service.decide(
          'cycle-1',
          'dept-1',
          { decision: 'APPROVE' },
          makeApprover('approver-1'),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when the cycle is inactive', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(makeCycle({ isActive: false }));
      await expect(
        service.decide(
          'cycle-1',
          'dept-1',
          { decision: 'APPROVE' },
          makeApprover('approver-1'),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("403s when the acting admin is not the current level's approver", async () => {
      mockApprovalRepo.findOne.mockResolvedValue({
        id: 'approval-1',
        currentLevel: 1,
        status: DepartmentGoalApprovalStatus.PENDING,
      });
      await expect(
        service.decide(
          'cycle-1',
          'dept-1',
          { decision: 'APPROVE' },
          makeApprover('someone-else'),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it("403s a self-review attempt by the department's own HOD", async () => {
      mockApprovalRepo.findOne.mockResolvedValue({
        id: 'approval-1',
        currentLevel: 1,
        status: DepartmentGoalApprovalStatus.PENDING,
      });
      const selfReviewAdmin = {
        id: 'approver-1',
        member: { id: 'hod-member-1' },
      } as Admin;
      await expect(
        service.decide(
          'cycle-1',
          'dept-1',
          { decision: 'APPROVE' },
          selfReviewAdmin,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects REQUEST_CHANGES with a blank comment', async () => {
      mockApprovalRepo.findOne.mockResolvedValue({
        id: 'approval-1',
        currentLevel: 1,
        status: DepartmentGoalApprovalStatus.PENDING,
      });
      await expect(
        service.decide(
          'cycle-1',
          'dept-1',
          { decision: 'REQUEST_CHANGES', comment: '   ' },
          makeApprover('approver-1'),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects deciding on an already-COMPLETE approval', async () => {
      mockApprovalRepo.findOne.mockResolvedValue({
        id: 'approval-1',
        currentLevel: 2,
        status: DepartmentGoalApprovalStatus.COMPLETE,
      });
      await expect(
        service.decide(
          'cycle-1',
          'dept-1',
          { decision: 'APPROVE' },
          makeApprover('approver-2'),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('advances to the next level on approve when more levels remain', async () => {
      mockApprovalRepo.findOne.mockResolvedValue({
        id: 'approval-1',
        currentLevel: 1,
        status: DepartmentGoalApprovalStatus.PENDING,
      });
      const result = await service.decide(
        'cycle-1',
        'dept-1',
        { decision: 'APPROVE' },
        makeApprover('approver-1'),
      );
      expect(result.currentLevel).toBe(2);
      expect(result.status).toBe(DepartmentGoalApprovalStatus.PENDING);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'DEPARTMENT_GOAL_APPROVAL_APPROVED',
        expect.objectContaining({ actorId: 'member-approver-1' }),
      );
      expect(mockNotificationDispatchService.notifyMember).toHaveBeenCalledWith(
        expect.objectContaining({
          category: EmailCategory.DEPARTMENT_GOAL_ACTIVITY,
          push: expect.objectContaining({ memberIds: ['hod-member-1'] }),
        }),
      );
    });

    it('marks COMPLETE on approve at the final level', async () => {
      mockApprovalRepo.findOne.mockResolvedValue({
        id: 'approval-1',
        currentLevel: 2,
        status: DepartmentGoalApprovalStatus.PENDING,
      });
      const result = await service.decide(
        'cycle-1',
        'dept-1',
        { decision: 'APPROVE' },
        makeApprover('approver-2'),
      );
      expect(result.status).toBe(DepartmentGoalApprovalStatus.COMPLETE);
      expect(result.completedAt).toBeInstanceOf(Date);
    });

    it('sets CHANGES_REQUESTED without advancing the level, and notifies the HOD', async () => {
      mockApprovalRepo.findOne.mockResolvedValue({
        id: 'approval-1',
        currentLevel: 1,
        status: DepartmentGoalApprovalStatus.PENDING,
      });
      const result = await service.decide(
        'cycle-1',
        'dept-1',
        { decision: 'REQUEST_CHANGES', comment: 'Please add more detail' },
        makeApprover('approver-1'),
      );
      expect(result.status).toBe(
        DepartmentGoalApprovalStatus.CHANGES_REQUESTED,
      );
      expect(result.currentLevel).toBe(1);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'DEPARTMENT_GOAL_APPROVAL_CHANGES_REQUESTED',
        expect.objectContaining({ actorId: 'member-approver-1' }),
      );
      expect(mockNotificationDispatchService.notifyMember).toHaveBeenCalled();
    });
  });

  describe('onHodGoalWrite', () => {
    it('flips CHANGES_REQUESTED back to PENDING at the same level', async () => {
      mockApprovalRepo.findOne.mockResolvedValue({
        id: 'approval-1',
        currentLevel: 2,
        status: DepartmentGoalApprovalStatus.CHANGES_REQUESTED,
      });
      await service.onHodGoalWrite(makeCycle(), 'dept-1', 'member-1');
      expect(mockApprovalRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          currentLevel: 2,
          status: DepartmentGoalApprovalStatus.PENDING,
        }),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'DEPARTMENT_GOAL_APPROVAL_RESUBMITTED',
        expect.objectContaining({ actorId: 'member-1' }),
      );
    });

    it('is a no-op when status is not CHANGES_REQUESTED', async () => {
      mockApprovalRepo.findOne.mockResolvedValue({
        id: 'approval-1',
        currentLevel: 1,
        status: DepartmentGoalApprovalStatus.PENDING,
      });
      await service.onHodGoalWrite(makeCycle(), 'dept-1', 'member-1');
      expect(mockApprovalRepo.save).not.toHaveBeenCalled();
      expect(mockAuditLogService.log).not.toHaveBeenCalled();
    });
  });

  describe('addComment / getThread', () => {
    it('adds a general comment with no approvalLevel/decision, and notifies the leads', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(makeCycle());
      mockDepartmentService.getDepartmentLeads.mockResolvedValue({
        name: 'Ushering',
        head: { member: { id: 'hod-member-1' } },
        assistant: { member: { id: 'dhod-member-1' } },
      });
      const admin = makeApprover('approver-1');

      const comment = await service.addComment(
        'cycle-1',
        'dept-1',
        'Nice progress so far',
        admin,
      );
      expect(comment.approvalLevel).toBeNull();
      expect(comment.decision).toBeNull();
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'DEPARTMENT_GOAL_COMMENT_ADDED',
        expect.objectContaining({ actorId: 'member-approver-1' }),
      );
      expect(mockNotificationDispatchService.notifyMember).toHaveBeenCalledWith(
        expect.objectContaining({
          push: expect.objectContaining({
            memberIds: ['hod-member-1', 'dhod-member-1'],
          }),
        }),
      );
    });

    it("returns comments in ascending createdAt order with the poster's real name", async () => {
      mockCommentRepo.find.mockResolvedValue([
        {
          id: 'c1',
          content: 'First',
          approvalLevel: null,
          decision: null,
          createdAt: new Date('2026-06-01'),
          postedByAdmin: { member: { firstname: 'Ada', lastname: 'Lovelace' } },
        },
        {
          id: 'c2',
          content: 'Second',
          approvalLevel: 1,
          decision: 'APPROVED',
          createdAt: new Date('2026-06-02'),
          postedByAdmin: null,
        },
      ]);
      const result = await service.getThread('cycle-1', 'dept-1');
      expect(mockCommentRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ order: { createdAt: 'ASC' } }),
      );
      expect(result[0].postedByAdminName).toBe('Ada Lovelace');
      expect(result[1].postedByAdminName).toBeNull();
    });
  });

  describe('decide with a level override', () => {
    it('authorizes against the OVERRIDE admin, not the cycle default, when one is set for the current level', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(makeCycle());
      mockDepartmentService.getDepartmentLeads.mockResolvedValue({
        name: 'Ushering',
        head: { member: { id: 'hod-member-1' } },
        assistant: null,
      });
      mockApprovalRepo.findOne.mockResolvedValue({
        id: 'approval-1',
        currentLevel: 1,
        status: DepartmentGoalApprovalStatus.PENDING,
        levelOverrides: [{ level: 1, adminId: 'override-approver' }],
      });

      // The cycle's default Level 1 approver ('approver-1') must now be
      // rejected — only the override admin can act on this department.
      await expect(
        service.decide(
          'cycle-1',
          'dept-1',
          { decision: 'APPROVE' },
          makeApprover('approver-1'),
        ),
      ).rejects.toThrow(ForbiddenException);

      const result = await service.decide(
        'cycle-1',
        'dept-1',
        { decision: 'APPROVE' },
        makeApprover('override-approver'),
      );
      expect(result.currentLevel).toBe(2);
    });
  });

  describe('setLevelOverride', () => {
    it('rejects when the cycle has no approval chain configured', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(
        makeCycle({ approvalChain: null }),
      );
      await expect(
        service.setLevelOverride(
          'cycle-1',
          'dept-1',
          { level: 1, adminId: 'new-approver' },
          makeApprover('actor-1'),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a level beyond the chain length', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(makeCycle()); // 2 levels
      await expect(
        service.setLevelOverride(
          'cycle-1',
          'dept-1',
          { level: 3, adminId: 'new-approver' },
          makeApprover('actor-1'),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects an override admin who is this department's own HOD", async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(makeCycle());
      mockApprovalRepo.findOne.mockResolvedValue(null);
      mockDepartmentService.getDepartmentLeads.mockResolvedValue({
        name: 'Ushering',
        head: { member: { id: 'member-hod-approver' } },
        assistant: null,
      });

      await expect(
        service.setLevelOverride(
          'cycle-1',
          'dept-1',
          { level: 1, adminId: 'hod-approver' },
          makeApprover('actor-1'),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an override admin already assigned to another level in the effective chain', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(makeCycle()); // level 2 = approver-2
      mockApprovalRepo.findOne.mockResolvedValue(null);

      await expect(
        service.setLevelOverride(
          'cycle-1',
          'dept-1',
          { level: 1, adminId: 'approver-2' },
          makeApprover('actor-1'),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('sets an override for the current level and reports it as overridden', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(makeCycle());
      mockApprovalRepo.findOne.mockResolvedValue({
        id: 'approval-1',
        currentLevel: 1,
        status: DepartmentGoalApprovalStatus.PENDING,
        levelOverrides: null,
      });

      const result = await service.setLevelOverride(
        'cycle-1',
        'dept-1',
        { level: 1, adminId: 'override-approver' },
        makeApprover('actor-1'),
      );

      expect(result.isCurrentLevelOverridden).toBe(true);
      expect(mockApprovalRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          levelOverrides: [{ level: 1, adminId: 'override-approver' }],
        }),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'DEPARTMENT_GOAL_APPROVAL_LEVEL_OVERRIDE_SET',
        expect.objectContaining({ actorId: 'member-actor-1' }),
      );
    });

    it('clears an override when adminId is null', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(makeCycle());
      mockApprovalRepo.findOne.mockResolvedValue({
        id: 'approval-1',
        currentLevel: 1,
        status: DepartmentGoalApprovalStatus.PENDING,
        levelOverrides: [{ level: 1, adminId: 'override-approver' }],
      });

      const result = await service.setLevelOverride(
        'cycle-1',
        'dept-1',
        { level: 1, adminId: null },
        makeApprover('actor-1'),
      );

      expect(result.isCurrentLevelOverridden).toBe(false);
      expect(mockApprovalRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ levelOverrides: null }),
      );
    });

    it('leaves an override on a DIFFERENT level untouched when clearing one level', async () => {
      mockCycleRepo.findOneBy.mockResolvedValue(makeCycle());
      mockApprovalRepo.findOne.mockResolvedValue({
        id: 'approval-1',
        currentLevel: 1,
        status: DepartmentGoalApprovalStatus.PENDING,
        levelOverrides: [
          { level: 1, adminId: 'override-1' },
          { level: 2, adminId: 'override-2' },
        ],
      });

      await service.setLevelOverride(
        'cycle-1',
        'dept-1',
        { level: 1, adminId: null },
        makeApprover('actor-1'),
      );

      expect(mockApprovalRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          levelOverrides: [{ level: 2, adminId: 'override-2' }],
        }),
      );
    });
  });
});
