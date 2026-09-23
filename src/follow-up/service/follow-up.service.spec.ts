import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import { FollowUpService } from './follow-up.service';
import { FirstTimer } from '../entity/first-timer.entity';
import { FollowUpTask } from '../entity/follow-up-task.entity';
import { FollowUpNote } from '../entity/follow-up-note.entity';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import {
  ContactMethodEnum,
  FirstTimerSourceEnum,
  FollowUpOutcomeEnum,
  FollowUpTaskStatusEnum,
  FollowUpTaskTypeEnum,
} from '../enums/follow-up.enum';
import { FirstTimerVisit } from '../entity/first-timer-visit.entity';
import { DepartmentCapability } from '../../department/enums/department-capability.enum';
import { DepartmentAccessService } from '../../department/service/department-access.service';
import { WorkerStatusEnum } from '../../member/enums/worker-status.enum';
import { EmailQueueService } from '../../utility/service/email-queue.service';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { Event } from '../../event/entity/event.entity';
import { SundaySchoolAttendance } from '../../sunday-school/entity/sunday-school-attendance.entity';

const mockCacheService = {
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(1),
  getOrSet: jest
    .fn()
    .mockImplementation((_key: string, fn: () => Promise<unknown>) => fn()),
  flushNamespace: jest.fn().mockResolvedValue(undefined),
};

const mockFirstTimerRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  findAndCount: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockTaskRepo = {
  exists: jest.fn().mockResolvedValue(false),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockNoteRepo = {
  save: jest.fn(),
  create: jest.fn(),
};

const mockVisitRepo = {
  save: jest.fn(),
  create: jest.fn(),
};

const workerProfileQbMock = {
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
};

const mockWorkerProfileRepo = {
  findOne: jest.fn(),
  createQueryBuilder: jest.fn().mockReturnValue(workerProfileQbMock),
};

const eventQbMock = {
  select: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
};

const mockEventRepo = {
  createQueryBuilder: jest.fn().mockReturnValue(eventQbMock),
};

const ssaQbMock = {
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  getRawMany: jest.fn(),
};

const firstTimersListQbMock = {
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  loadRelationCountAndMap: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn(),
};

const mockSundaySchoolAttendanceRepo = {
  createQueryBuilder: jest.fn().mockReturnValue(ssaQbMock),
  find: jest.fn(),
};

const qbMock = {
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  leftJoin: jest.fn().mockReturnThis(),
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getRawMany: jest.fn(),
  getRawOne: jest.fn(),
  getManyAndCount: jest.fn(),
};

const mockDataSource = {
  createQueryBuilder: jest.fn().mockReturnValue(qbMock),
  query: jest.fn(),
};

const mockManager = {
  query: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

const mockTxHost = {
  tx: mockManager,
};

const mockConfigService = {
  get: jest.fn((key: string, def: any) => def),
};

const mockEmailQueueService = {
  queueEmailWithTemplate: jest.fn(),
};

const mockAuditLogService = { log: jest.fn() };

const mockDepartmentAccessService = {
  hasCapability: jest.fn(),
  assertHasCapability: jest.fn(),
};

const followUpProfile = {
  id: 'wp-1',
  status: WorkerStatusEnum.ACTIVE,
  member: { id: 'member-1', firstname: 'Ada', email: 'ada@test.com' },
  department: {
    id: 'dept-1',
    capabilities: [DepartmentCapability.MANAGE_FOLLOW_UP],
    name: 'Follow-Up',
  },
  secondaryDepartment: null,
};

const nonFollowUpProfile = {
  id: 'wp-2',
  status: WorkerStatusEnum.ACTIVE,
  member: { id: 'member-2', firstname: 'Bola', email: 'bola@test.com' },
  department: { id: 'dept-2', capabilities: [], name: 'Worship' },
  secondaryDepartment: null,
};

describe('FollowUpService', () => {
  let service: FollowUpService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default: authorize as a Follow-Up dept worker so functional tests focus
    // on business logic; individual tests override with mockRejectedValueOnce.
    mockDepartmentAccessService.assertHasCapability.mockResolvedValue(
      undefined,
    );
    mockManager.query.mockReset();
    mockManager.findOne.mockReset();
    mockManager.create
      .mockReset()
      .mockImplementation((_e: unknown, data: unknown) => data);
    mockManager.save
      .mockReset()
      .mockImplementation((a: unknown, b?: unknown) =>
        Promise.resolve(b !== undefined ? b : a),
      );
    qbMock.getRawMany.mockResolvedValue([]);
    qbMock.getRawOne.mockResolvedValue({
      total: '0',
      wantsToJoinChurch: '0',
      wantsToJoinWorkforce: '0',
      count: '0',
    });
    eventQbMock.getMany.mockResolvedValue([]);
    workerProfileQbMock.getMany.mockResolvedValue([]);
    ssaQbMock.getRawMany.mockResolvedValue([]);
    mockSundaySchoolAttendanceRepo.find.mockResolvedValue([]);
    firstTimersListQbMock.getManyAndCount.mockResolvedValue([[], 0]);
    mockFirstTimerRepo.createQueryBuilder.mockReturnValue(
      firstTimersListQbMock,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FollowUpService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: TransactionHost, useValue: mockTxHost },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: EmailQueueService, useValue: mockEmailQueueService },
        { provide: AuditLogService, useValue: mockAuditLogService },
        {
          provide: getRepositoryToken(FirstTimer),
          useValue: mockFirstTimerRepo,
        },
        { provide: getRepositoryToken(FollowUpTask), useValue: mockTaskRepo },
        { provide: getRepositoryToken(FollowUpNote), useValue: mockNoteRepo },
        {
          provide: getRepositoryToken(WorkerProfile),
          useValue: mockWorkerProfileRepo,
        },
        {
          provide: getRepositoryToken(FirstTimerVisit),
          useValue: mockVisitRepo,
        },
        {
          provide: getRepositoryToken(Event),
          useValue: mockEventRepo,
        },
        {
          provide: getRepositoryToken(SundaySchoolAttendance),
          useValue: mockSundaySchoolAttendanceRepo,
        },
        {
          provide: DepartmentAccessService,
          useValue: mockDepartmentAccessService,
        },
      ],
    }).compile();

    service = module.get<FollowUpService>(FollowUpService);
  });

  // ── assertWorkerInFollowUpDept ────────────────────────────────────────────

  describe('assertWorkerInFollowUpDept', () => {
    it('propagates the ForbiddenException thrown by DepartmentAccessService', async () => {
      mockDepartmentAccessService.assertHasCapability.mockRejectedValueOnce(
        new ForbiddenException(
          'Access restricted to Follow-Up department workers',
        ),
      );
      await expect(
        service.assertWorkerInFollowUpDept('member-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('delegates to DepartmentAccessService with the FOLLOW_UP key', async () => {
      mockDepartmentAccessService.assertHasCapability.mockResolvedValue(
        undefined,
      );
      await service.assertWorkerInFollowUpDept('member-1');

      expect(
        mockDepartmentAccessService.assertHasCapability,
      ).toHaveBeenCalledWith(
        'member-1',
        DepartmentCapability.MANAGE_FOLLOW_UP,
        expect.any(String),
      );
    });
  });

  // ── pickRoundRobinAssignee ────────────────────────────────────────────────

  describe('pickRoundRobinAssignee', () => {
    it('returns null when no FOLLOW_UP workers exist', async () => {
      qbMock.getRawMany.mockResolvedValue([]);
      const result = await service.pickRoundRobinAssignee();
      expect(result).toBeNull();
    });

    it('returns the worker with the fewest open tasks (with member relation)', async () => {
      qbMock.getRawMany.mockResolvedValue([{ id: 'wp-1', openCount: '0' }]);
      mockWorkerProfileRepo.findOne.mockResolvedValue(followUpProfile);
      const result = await service.pickRoundRobinAssignee();
      expect(result).toEqual(followUpProfile);
      expect(mockWorkerProfileRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'wp-1' },
        relations: ['member'],
      });
    });
  });

  // ── createFirstTimerByWorker ──────────────────────────────────────────────

  describe('createFirstTimerByWorker', () => {
    it('throws ForbiddenException when caller is not in FOLLOW_UP dept', async () => {
      mockDepartmentAccessService.assertHasCapability.mockRejectedValueOnce(
        new ForbiddenException(
          'Access restricted to Follow-Up department workers',
        ),
      );
      await expect(
        service.createFirstTimerByWorker(
          { firstname: 'A', lastname: 'B', phone: '08011111111' },
          'member-1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('creates the first-timer unassigned (with a warning, not an error) when no FOLLOW_UP worker is available', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue(followUpProfile);
      const savedFirstTimer = { id: 'ft-2', firstname: 'A', lastname: 'B' };
      const savedTask = {
        id: 'task-2',
        type: FollowUpTaskTypeEnum.FIRST_TIMER,
      };
      mockManager.query
        .mockResolvedValueOnce([]) // advisory lock
        .mockResolvedValueOnce([]); // pick → no workers
      mockManager.create.mockImplementation((entity: any) =>
        entity === FollowUpTask ? savedTask : savedFirstTimer,
      );
      mockManager.save
        .mockResolvedValueOnce(savedFirstTimer)
        .mockResolvedValueOnce(savedTask);

      const result = await service.createFirstTimerByWorker(
        { firstname: 'A', lastname: 'B', phone: '08011111111' },
        'member-1',
      );

      expect(result.assignmentWarning).toEqual(
        expect.stringContaining('unassigned'),
      );
      expect(mockManager.create).toHaveBeenCalledWith(
        FollowUpTask,
        expect.objectContaining({ assignedTo: null }),
      );
      expect(
        mockEmailQueueService.queueEmailWithTemplate,
      ).not.toHaveBeenCalled();
    });

    it('creates first-timer, assigns task, and sends assignment email', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue(followUpProfile);

      const savedFirstTimer = {
        id: 'ft-1',
        firstname: 'Ada',
        lastname: 'Obi',
        phone: '08011111111',
      };
      const savedTask = {
        id: 'task-1',
        type: FollowUpTaskTypeEnum.FIRST_TIMER,
      };

      mockManager.query
        .mockResolvedValueOnce([]) // advisory lock
        .mockResolvedValueOnce([{ id: 'wp-1' }]); // pick
      mockManager.findOne.mockResolvedValue(followUpProfile);
      mockManager.create.mockImplementation((entity: any) =>
        entity === FollowUpTask ? savedTask : savedFirstTimer,
      );
      mockManager.save
        .mockResolvedValueOnce(savedFirstTimer)
        .mockResolvedValueOnce(savedTask);

      const result = await service.createFirstTimerByWorker(
        { firstname: 'Ada', lastname: 'Obi', phone: '08011111111' },
        'member-1',
      );

      expect(result).toMatchObject(savedFirstTimer);
      expect(mockEmailQueueService.queueEmailWithTemplate).toHaveBeenCalledWith(
        'ada@test.com',
        expect.stringContaining('New Follow-Up Task Assigned'),
        'follow-up-task-assigned',
        expect.objectContaining({
          workerName: 'Ada',
          firstTimerName: 'Ada Obi',
        }),
        undefined,
        'FOLLOW_UP',
      );
    });
  });

  // ── createFirstTimerByAdmin ───────────────────────────────────────────────

  describe('createFirstTimerByAdmin', () => {
    it('creates first-timer linked to admin and sends assignment email', async () => {
      const savedFirstTimer = { id: 'ft-2', firstname: 'Bola' };

      mockManager.query
        .mockResolvedValueOnce([]) // advisory lock
        .mockResolvedValueOnce([{ id: 'wp-1' }]); // pick
      mockManager.findOne.mockResolvedValue(followUpProfile);
      mockManager.create.mockReturnValue(savedFirstTimer);
      mockManager.save.mockResolvedValue(savedFirstTimer);

      const result = await service.createFirstTimerByAdmin(
        { firstname: 'Bola', lastname: 'Ade', phone: '08022222222' },
        'admin-1',
      );

      expect(result).toMatchObject(savedFirstTimer);
      expect(mockEmailQueueService.queueEmailWithTemplate).toHaveBeenCalled();
    });
  });

  // ── createFirstTimerFromPublicForm ────────────────────────────────────────

  describe('createFirstTimerFromPublicForm', () => {
    it('forces source to ONLINE regardless of the DTO and uses an empty actor', async () => {
      const savedFirstTimer = { id: 'ft-3', firstname: 'Chris' };
      let capturedCreateArgs: any;

      mockManager.query
        .mockResolvedValueOnce([]) // advisory lock
        .mockResolvedValueOnce([{ id: 'wp-1' }]); // pick
      mockManager.findOne.mockResolvedValue(followUpProfile);
      mockManager.create.mockImplementation((entity: any, args: any) => {
        if (entity === FirstTimer) capturedCreateArgs = args;
        return entity === FirstTimer ? savedFirstTimer : args;
      });
      mockManager.save.mockResolvedValue(savedFirstTimer);

      const result = await service.createFirstTimerFromPublicForm({
        firstname: 'Chris',
        lastname: 'Okafor',
        phone: '+2348012345678',
        source: FirstTimerSourceEnum.WALK_IN,
      } as any);

      expect(result).toMatchObject(savedFirstTimer);
      expect(capturedCreateArgs).toEqual(
        expect.objectContaining({
          source: FirstTimerSourceEnum.ONLINE,
          createdByMember: null,
          createdByAdmin: null,
        }),
      );
    });
  });

  describe('createFirstTimerFromAppSignup', () => {
    it('forces source to APP_SIGNUP regardless of the DTO and uses an empty actor', async () => {
      const savedFirstTimer = { id: 'ft-4', firstname: 'Ada' };
      let capturedCreateArgs: any;

      mockManager.query
        .mockResolvedValueOnce([]) // advisory lock
        .mockResolvedValueOnce([{ id: 'wp-1' }]); // pick
      mockManager.findOne.mockResolvedValue(followUpProfile);
      mockManager.create.mockImplementation((entity: any, args: any) => {
        if (entity === FirstTimer) capturedCreateArgs = args;
        return entity === FirstTimer ? savedFirstTimer : args;
      });
      mockManager.save.mockResolvedValue(savedFirstTimer);

      const result = await service.createFirstTimerFromAppSignup({
        firstname: 'Ada',
        lastname: 'Okoye',
        phone: '+2348012345679',
        source: FirstTimerSourceEnum.REFERRAL,
      } as any);

      expect(result).toMatchObject(savedFirstTimer);
      expect(capturedCreateArgs).toEqual(
        expect.objectContaining({
          source: FirstTimerSourceEnum.APP_SIGNUP,
          createdByMember: null,
          createdByAdmin: null,
        }),
      );
    });
  });

  // ── updateTask ───────────────────────────────────────────────────────────

  describe('updateTask', () => {
    it('throws ForbiddenException when caller is not in FOLLOW_UP dept', async () => {
      mockDepartmentAccessService.assertHasCapability.mockRejectedValueOnce(
        new ForbiddenException(
          'Access restricted to Follow-Up department workers',
        ),
      );
      await expect(
        service.updateTask(
          'task-1',
          { status: FollowUpTaskStatusEnum.IN_PROGRESS },
          'member-1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when task not found or not assigned to caller', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue(followUpProfile);
      mockTaskRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateTask(
          'task-1',
          { status: FollowUpTaskStatusEnum.IN_PROGRESS },
          'member-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates status, outcome, and adds a note when provided', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue(followUpProfile);
      const task = {
        id: 'task-1',
        status: FollowUpTaskStatusEnum.PENDING,
        outcome: null,
        outcomeNotes: null,
      };
      mockTaskRepo.findOne.mockResolvedValue(task);
      mockTaskRepo.save.mockResolvedValue({
        ...task,
        status: FollowUpTaskStatusEnum.COMPLETED,
        outcome: FollowUpOutcomeEnum.JOINED,
      });
      mockNoteRepo.create.mockReturnValue({ content: 'Spoke with them' });
      mockNoteRepo.save.mockResolvedValue({});

      const result = await service.updateTask(
        'task-1',
        {
          status: FollowUpTaskStatusEnum.COMPLETED,
          outcome: FollowUpOutcomeEnum.JOINED,
          noteContent: 'Spoke with them',
        },
        'member-1',
      );

      expect(result.status).toBe(FollowUpTaskStatusEnum.COMPLETED);
      expect(mockNoteRepo.save).toHaveBeenCalled();
    });
  });

  // ── reassignTask ─────────────────────────────────────────────────────────

  describe('reassignTask', () => {
    it('throws NotFoundException when task not found', async () => {
      mockTaskRepo.findOne.mockResolvedValue(null);
      mockWorkerProfileRepo.findOne.mockResolvedValue(followUpProfile);
      await expect(
        service.reassignTask('task-x', { workerProfileId: 'wp-1' }, 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when target worker profile not found', async () => {
      mockTaskRepo.findOne.mockResolvedValue({ id: 'task-1' });
      mockWorkerProfileRepo.findOne.mockResolvedValue(null);
      await expect(
        service.reassignTask('task-1', { workerProfileId: 'wp-x' }, 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when target worker is not in FOLLOW_UP dept', async () => {
      mockTaskRepo.findOne.mockResolvedValue({
        id: 'task-1',
        assignedTo: followUpProfile,
      });
      mockWorkerProfileRepo.findOne
        .mockResolvedValueOnce(nonFollowUpProfile)
        .mockResolvedValueOnce(nonFollowUpProfile);
      await expect(
        service.reassignTask('task-1', { workerProfileId: 'wp-2' }, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when target worker is not ACTIVE', async () => {
      const inactiveFollowUpProfile = {
        ...followUpProfile,
        id: 'wp-3',
        status: WorkerStatusEnum.INACTIVE,
      };
      mockTaskRepo.findOne.mockResolvedValue({
        id: 'task-1',
        assignedTo: followUpProfile,
      });
      mockWorkerProfileRepo.findOne
        .mockResolvedValueOnce(inactiveFollowUpProfile)
        .mockResolvedValueOnce(inactiveFollowUpProfile);
      await expect(
        service.reassignTask('task-1', { workerProfileId: 'wp-3' }, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('reassigns task and sends email to new assignee', async () => {
      const task = {
        id: 'task-1',
        assignedTo: nonFollowUpProfile,
        dueDate: null,
      };
      mockTaskRepo.findOne.mockResolvedValue(task);
      mockWorkerProfileRepo.findOne
        .mockResolvedValueOnce(followUpProfile)
        .mockResolvedValueOnce(followUpProfile);
      mockTaskRepo.save.mockResolvedValue({
        ...task,
        assignedTo: followUpProfile,
      });

      const result = await service.reassignTask(
        'task-1',
        { workerProfileId: 'wp-1' },
        'admin-1',
      );
      expect(result.assignedTo).toEqual(followUpProfile);
      expect(mockEmailQueueService.queueEmailWithTemplate).toHaveBeenCalledWith(
        'ada@test.com',
        expect.stringContaining('Reassigned'),
        'follow-up-task-assigned',
        expect.objectContaining({ workerName: 'Ada' }),
        undefined,
        'FOLLOW_UP',
      );
    });
  });

  describe('getActiveFollowUpWorkers', () => {
    it('filters to active workers with the FOLLOW_UP capability', async () => {
      workerProfileQbMock.getMany.mockResolvedValueOnce([followUpProfile]);

      const result = await service.getActiveFollowUpWorkers();

      expect(workerProfileQbMock.andWhere).toHaveBeenCalledWith(
        'wp.status = :status',
        { status: WorkerStatusEnum.ACTIVE },
      );
      expect(result).toEqual([followUpProfile]);
    });
  });

  // ── bulkUpdateTasks ──────────────────────────────────────────────────────

  describe('bulkUpdateTasks', () => {
    it('updates all matching tasks and returns count', async () => {
      const tasks = [
        { id: 'task-1', status: FollowUpTaskStatusEnum.PENDING },
        { id: 'task-2', status: FollowUpTaskStatusEnum.PENDING },
      ];
      mockTaskRepo.find.mockResolvedValue(tasks);
      mockTaskRepo.save.mockResolvedValue(tasks);

      const result = await service.bulkUpdateTasks({
        tasks: [
          { id: 'task-1', status: FollowUpTaskStatusEnum.COMPLETED },
          { id: 'task-2', status: FollowUpTaskStatusEnum.COMPLETED },
        ],
      });

      expect(result).toEqual({ updated: 2 });
      expect(tasks[0].status).toBe(FollowUpTaskStatusEnum.COMPLETED);
      expect(tasks[1].status).toBe(FollowUpTaskStatusEnum.COMPLETED);
    });
  });

  // ── createTaskForOnlineNonResponder ──────────────────────────────────────

  describe('createTaskForOnlineNonResponder', () => {
    it('returns null when no FOLLOW_UP assignee is available', async () => {
      qbMock.getRawMany.mockResolvedValue([]);
      const result = await service.createTaskForOnlineNonResponder(
        'member-1',
        'event-1',
      );
      expect(result).toBeNull();
    });

    it('creates task, sets dueDate, and sends assignment email', async () => {
      qbMock.getRawMany.mockResolvedValue([{ id: 'wp-1', openCount: '1' }]);
      mockWorkerProfileRepo.findOne.mockResolvedValue(followUpProfile);
      const task = {
        id: 'task-online-1',
        type: FollowUpTaskTypeEnum.ONLINE_NO_RESPONSE,
      };
      mockTaskRepo.create.mockReturnValue(task);
      mockTaskRepo.save.mockResolvedValue(task);

      const result = await service.createTaskForOnlineNonResponder(
        'member-1',
        'event-1',
      );
      expect(result?.type).toBe(FollowUpTaskTypeEnum.ONLINE_NO_RESPONSE);
      expect(mockTaskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ dueDate: expect.any(Date) }),
      );
      expect(mockEmailQueueService.queueEmailWithTemplate).toHaveBeenCalledWith(
        'ada@test.com',
        expect.any(String),
        'follow-up-task-assigned',
        expect.objectContaining({ workerName: 'Ada' }),
        undefined,
        'FOLLOW_UP',
      );
    });
  });

  // ── inviteFirstTimerToMembership ─────────────────────────────────────────

  describe('inviteFirstTimerToMembership', () => {
    it('throws NotFoundException when first-timer not found', async () => {
      mockFirstTimerRepo.findOne.mockResolvedValue(null);
      await expect(
        service.inviteFirstTimerToMembership('ft-x'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when first-timer has no email', async () => {
      mockFirstTimerRepo.findOne.mockResolvedValue({
        id: 'ft-1',
        email: null,
        inviteSentAt: null,
      });
      await expect(
        service.inviteFirstTimerToMembership('ft-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns { queued: false } without sending email when inviteSentAt is already set', async () => {
      mockFirstTimerRepo.findOne.mockResolvedValue({
        id: 'ft-1',
        email: 'visitor@test.com',
        inviteSentAt: new Date('2026-01-01'),
      });
      const result = await service.inviteFirstTimerToMembership('ft-1');
      expect(result).toEqual({ queued: false });
      expect(
        mockEmailQueueService.queueEmailWithTemplate,
      ).not.toHaveBeenCalled();
    });

    it('queues invite email and sets inviteSentAt on first send', async () => {
      const ft = {
        id: 'ft-1',
        firstname: 'Ada',
        lastname: 'Obi',
        email: 'visitor@test.com',
        inviteSentAt: null,
      };
      mockFirstTimerRepo.findOne.mockResolvedValue(ft);
      mockFirstTimerRepo.save.mockResolvedValue({
        ...ft,
        inviteSentAt: new Date(),
      });

      const result = await service.inviteFirstTimerToMembership('ft-1');
      expect(result).toEqual({ queued: true });
      expect(mockEmailQueueService.queueEmailWithTemplate).toHaveBeenCalledWith(
        'visitor@test.com',
        expect.stringContaining('Invited'),
        'first-timer-membership-invite',
        expect.objectContaining({ firstname: 'Ada', lastname: 'Obi' }),
        undefined,
        'FOLLOW_UP',
      );
      expect(mockFirstTimerRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ inviteSentAt: expect.any(Date) }),
      );
    });
  });

  // ── markConverted ─────────────────────────────────────────────────────────

  describe('markConverted', () => {
    it('throws NotFoundException when first-timer not found', async () => {
      mockFirstTimerRepo.findOne.mockResolvedValue(null);
      await expect(service.markConverted('ft-x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('sets convertedAt and saves without a memberId', async () => {
      const ft = { id: 'ft-1', convertedAt: null, convertedMember: null };
      mockFirstTimerRepo.findOne.mockResolvedValue(ft);
      mockFirstTimerRepo.save.mockResolvedValue({
        ...ft,
        convertedAt: new Date(),
      });

      const result = await service.markConverted('ft-1');
      expect(result.convertedAt).toBeInstanceOf(Date);
      expect(mockFirstTimerRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          convertedAt: expect.any(Date),
          convertedMember: null,
        }),
      );
    });

    it('links convertedMember when memberId is provided', async () => {
      const ft = { id: 'ft-1', convertedAt: null, convertedMember: null };
      mockFirstTimerRepo.findOne.mockResolvedValue(ft);
      mockFirstTimerRepo.save.mockImplementation((v: any) =>
        Promise.resolve(v),
      );

      await service.markConverted('ft-1', 'member-99');
      expect(mockFirstTimerRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ convertedMember: { id: 'member-99' } }),
      );
    });
  });

  // ── updateFirstTimer ─────────────────────────────────────────────────────

  describe('updateFirstTimer', () => {
    it('throws NotFoundException when first-timer not found', async () => {
      mockFirstTimerRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.updateFirstTimer('ft-x', { phone: '08099999999' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('applies only the provided fields and reloads with visitedEvent', async () => {
      const ft = {
        id: 'ft-1',
        firstname: 'Ada',
        lastname: 'Obi',
        phone: '08011111111',
        email: null,
        wantsToJoinChurch: false,
        wantsToJoinWorkforce: false,
        enjoyedAboutChurch: null,
        notes: null,
        visitedEvent: null,
      };
      const reloaded = {
        ...ft,
        phone: '08022222222',
        visitedEvent: { id: 'event-1', name: 'Sunday Service' },
      };
      mockFirstTimerRepo.findOne
        .mockResolvedValueOnce(ft)
        .mockResolvedValueOnce(reloaded);
      mockFirstTimerRepo.save.mockResolvedValue(undefined);

      const result = await service.updateFirstTimer('ft-1', {
        phone: '08022222222',
        visitedEventId: 'event-1',
      });

      expect(mockFirstTimerRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          phone: '08022222222',
          visitedEvent: { id: 'event-1' },
          firstname: 'Ada', // untouched fields are left as-is
        }),
      );
      expect(result).toEqual(reloaded);
    });

    it('leaves a field untouched when it is not part of the update', async () => {
      const ft = { id: 'ft-1', notes: 'Original note', phone: '08011111111' };
      mockFirstTimerRepo.findOne
        .mockResolvedValueOnce(ft)
        .mockResolvedValueOnce(ft);
      mockFirstTimerRepo.save.mockResolvedValue(undefined);

      await service.updateFirstTimer('ft-1', { phone: '08022222222' });

      expect(mockFirstTimerRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ notes: 'Original note' }),
      );
    });
  });

  describe('updateFirstTimerByWorker', () => {
    it('propagates ForbiddenException from the department check before loading anything', async () => {
      mockDepartmentAccessService.assertHasCapability.mockRejectedValueOnce(
        new ForbiddenException(
          'Access restricted to Follow-Up department workers',
        ),
      );

      await expect(
        service.updateFirstTimerByWorker(
          'ft-1',
          { phone: '08022222222' },
          'member-1',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(mockFirstTimerRepo.findOne).not.toHaveBeenCalled();
    });

    it('delegates to updateFirstTimer once authorized', async () => {
      const ft = { id: 'ft-1', phone: '08011111111' };
      mockFirstTimerRepo.findOne
        .mockResolvedValueOnce(ft)
        .mockResolvedValueOnce({ ...ft, phone: '08022222222' });
      mockFirstTimerRepo.save.mockResolvedValue(undefined);

      const result = await service.updateFirstTimerByWorker(
        'ft-1',
        { phone: '08022222222' },
        'member-1',
      );

      expect(result.phone).toBe('08022222222');
    });
  });

  // ── adminUpdateTask ───────────────────────────────────────────────────────

  describe('adminUpdateTask', () => {
    it('throws NotFoundException when task not found', async () => {
      mockTaskRepo.findOne.mockResolvedValue(null);
      await expect(
        service.adminUpdateTask('task-x', {
          status: FollowUpTaskStatusEnum.COMPLETED,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates status and outcome without worker restriction', async () => {
      const task = {
        id: 'task-1',
        status: FollowUpTaskStatusEnum.PENDING,
        outcome: null,
        outcomeNotes: null,
        dueDate: null,
        notes: [],
      };
      mockTaskRepo.findOne.mockResolvedValue(task);
      mockTaskRepo.save.mockImplementation((v: any) => Promise.resolve(v));

      const result = await service.adminUpdateTask('task-1', {
        status: FollowUpTaskStatusEnum.COMPLETED,
        outcome: FollowUpOutcomeEnum.JOINED,
        outcomeNotes: 'Member joined',
      });

      expect(result.status).toBe(FollowUpTaskStatusEnum.COMPLETED);
      expect(result.outcome).toBe(FollowUpOutcomeEnum.JOINED);
    });

    it('sets dueDate when provided', async () => {
      const task = {
        id: 'task-1',
        status: FollowUpTaskStatusEnum.PENDING,
        outcome: null,
        outcomeNotes: null,
        dueDate: null,
        notes: [],
      };
      mockTaskRepo.findOne.mockResolvedValue(task);
      mockTaskRepo.save.mockImplementation((v: any) => Promise.resolve(v));

      await service.adminUpdateTask('task-1', { dueDate: '2026-07-15' });
      expect(mockTaskRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ dueDate: new Date('2026-07-15') }),
      );
    });

    it('adds a note with addedBy null when noteContent is provided', async () => {
      const task = {
        id: 'task-1',
        status: FollowUpTaskStatusEnum.PENDING,
        outcome: null,
        outcomeNotes: null,
        dueDate: null,
        notes: [],
      };
      mockTaskRepo.findOne.mockResolvedValue(task);
      mockTaskRepo.save.mockImplementation((v: any) => Promise.resolve(v));
      mockNoteRepo.create.mockReturnValue({
        content: 'Admin note',
        addedBy: null,
      });
      mockNoteRepo.save.mockResolvedValue({});

      await service.adminUpdateTask('task-1', { noteContent: 'Admin note' });
      expect(mockNoteRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ addedBy: null, content: 'Admin note' }),
      );
      expect(mockNoteRepo.save).toHaveBeenCalled();
    });
  });

  // ── getReport ────────────────────────────────────────────────────────────

  describe('getReport', () => {
    beforeEach(() => {
      qbMock.getRawOne.mockResolvedValue({
        total: '5',
        wantsToJoinChurch: '3',
        wantsToJoinWorkforce: '2',
        count: '1',
      });
      qbMock.getRawMany.mockResolvedValue([]);
    });

    it('returns zeroed report when no data exists', async () => {
      qbMock.getRawOne.mockResolvedValue({
        total: '0',
        wantsToJoinChurch: '0',
        wantsToJoinWorkforce: '0',
        count: '0',
      });
      const report = await service.getReport();
      expect(report.firstTimers.total).toBe(0);
      expect(report.tasks.total).toBe(0);
      expect(report.tasks.conversionRate).toBe('0%');
    });

    it('returns all-time stats when no date range given', async () => {
      const report = await service.getReport();
      expect(report.period.from).toBeNull();
      expect(report.period.to).toBeNull();
    });

    it('returns period-filtered stats when date range provided', async () => {
      const from = new Date('2026-01-01');
      const to = new Date('2026-06-30');
      const report = await service.getReport(from, to);
      expect(report.period.from).toBe(from.toISOString());
      expect(report.period.to).toBe(to.toISOString());
    });

    it('computes conversionRate correctly', async () => {
      qbMock.getRawOne.mockResolvedValue({
        total: '0',
        wantsToJoinChurch: '0',
        wantsToJoinWorkforce: '0',
        count: '0',
      });
      qbMock.getRawMany
        .mockResolvedValueOnce([]) // sourceRows
        .mockResolvedValueOnce([
          // taskStatusRows
          { status: 'COMPLETED', count: '10' },
          { status: 'PENDING', count: '5' },
        ])
        .mockResolvedValueOnce([
          // outcomeRows
          { outcome: 'JOINED', count: '4' },
        ])
        .mockResolvedValueOnce([]) // workerRows
        .mockResolvedValueOnce([]); // eventRows

      const report = await service.getReport();
      expect(report.tasks.total).toBe(15);
      expect(report.tasks.conversionRate).toBe('26.7%');
    });

    it('maps byWorker and byEvent rows to numbers', async () => {
      qbMock.getRawOne.mockResolvedValue({
        total: '0',
        wantsToJoinChurch: '0',
        wantsToJoinWorkforce: '0',
        count: '0',
      });
      qbMock.getRawMany
        .mockResolvedValueOnce([]) // sourceRows
        .mockResolvedValueOnce([]) // taskStatusRows
        .mockResolvedValueOnce([]) // outcomeRows
        .mockResolvedValueOnce([
          { workerName: 'Ada Obi', assigned: '8', completed: '6', joined: '3' },
        ])
        .mockResolvedValueOnce([
          { eventName: 'Sunday Service', firstTimers: '12' },
        ]);

      const report = await service.getReport();
      expect(report.byWorker[0]).toEqual({
        workerName: 'Ada Obi',
        assigned: 8,
        completed: 6,
        joined: 3,
      });
      expect(report.byEvent[0]).toEqual({
        eventName: 'Sunday Service',
        firstTimers: 12,
      });
    });
  });

  // ── updateTask contactMethod ───────────────────────────────────────────────

  describe('updateTask — contactMethod propagation', () => {
    it('passes contactMethod to the note when provided', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue(followUpProfile);
      const task = {
        id: 'task-1',
        status: FollowUpTaskStatusEnum.PENDING,
        outcome: null,
        outcomeNotes: null,
        lastActivityAt: new Date(),
        assignedTo: followUpProfile,
        notes: [],
      };
      mockTaskRepo.findOne.mockResolvedValue(task);
      mockTaskRepo.save.mockResolvedValue(task);
      mockNoteRepo.create.mockImplementation((v: any) => v);
      mockNoteRepo.save.mockResolvedValue({});

      await service.updateTask(
        'task-1',
        {
          status: FollowUpTaskStatusEnum.IN_PROGRESS,
          noteContent: 'Called twice',
          contactMethod: ContactMethodEnum.PHONE_CALL,
        },
        'member-1',
      );

      expect(mockNoteRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          contactMethod: ContactMethodEnum.PHONE_CALL,
        }),
      );
    });

    it('sets contactMethod to null when not provided', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue(followUpProfile);
      const task = {
        id: 'task-1',
        status: FollowUpTaskStatusEnum.PENDING,
        outcome: null,
        outcomeNotes: null,
        lastActivityAt: new Date(),
        assignedTo: followUpProfile,
        notes: [],
      };
      mockTaskRepo.findOne.mockResolvedValue(task);
      mockTaskRepo.save.mockResolvedValue(task);
      mockNoteRepo.create.mockImplementation((v: any) => v);
      mockNoteRepo.save.mockResolvedValue({});

      await service.updateTask(
        'task-1',
        { noteContent: 'Just a note' },
        'member-1',
      );

      expect(mockNoteRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ contactMethod: null }),
      );
    });

    it('sets lastActivityAt when status is updated', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue(followUpProfile);
      const task = {
        id: 'task-1',
        status: FollowUpTaskStatusEnum.PENDING,
        outcome: null,
        outcomeNotes: null,
        lastActivityAt: new Date(0),
        assignedTo: followUpProfile,
        notes: [],
      };
      mockTaskRepo.findOne.mockResolvedValue(task);
      mockTaskRepo.save.mockImplementation((t: any) => Promise.resolve(t));

      await service.updateTask(
        'task-1',
        { status: FollowUpTaskStatusEnum.IN_PROGRESS },
        'member-1',
      );

      expect(task.lastActivityAt.getTime()).toBeGreaterThan(0);
    });
  });

  // ── addNote ───────────────────────────────────────────────────────────────

  describe('addNote', () => {
    it('throws NotFoundException when task not found or not assigned to worker', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue(followUpProfile);
      mockTaskRepo.findOne.mockResolvedValue(null);

      await expect(
        service.addNote('task-x', 'member-1', { content: 'Hi' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('saves note with contactMethod and updates lastActivityAt', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue(followUpProfile);
      const task = {
        id: 'task-1',
        lastActivityAt: new Date(0),
        assignedTo: followUpProfile,
      };
      mockTaskRepo.findOne.mockResolvedValue(task);
      mockTaskRepo.save.mockResolvedValue(task);
      const note = {
        id: 'note-1',
        content: 'Met in person',
        contactMethod: ContactMethodEnum.IN_PERSON,
      };
      mockNoteRepo.create.mockReturnValue(note);
      mockNoteRepo.save.mockResolvedValue(note);

      const result = await service.addNote('task-1', 'member-1', {
        content: 'Met in person',
        contactMethod: ContactMethodEnum.IN_PERSON,
      });

      expect(mockNoteRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Met in person',
          contactMethod: ContactMethodEnum.IN_PERSON,
        }),
      );
      expect(result.contactMethod).toBe(ContactMethodEnum.IN_PERSON);
      expect(task.lastActivityAt.getTime()).toBeGreaterThan(0);
    });

    it('saves note with null contactMethod when omitted', async () => {
      mockWorkerProfileRepo.findOne.mockResolvedValue(followUpProfile);
      const task = {
        id: 'task-1',
        lastActivityAt: new Date(0),
        assignedTo: followUpProfile,
      };
      mockTaskRepo.findOne.mockResolvedValue(task);
      mockTaskRepo.save.mockResolvedValue(task);
      mockNoteRepo.create.mockImplementation((v: any) => v);
      mockNoteRepo.save.mockImplementation((v: any) => Promise.resolve(v));

      await service.addNote('task-1', 'member-1', { content: 'Checked in' });

      expect(mockNoteRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ contactMethod: null }),
      );
    });
  });

  // ── logReturnVisit ────────────────────────────────────────────────────────

  describe('logReturnVisit', () => {
    it('throws NotFoundException when first-timer not found', async () => {
      mockFirstTimerRepo.findOne.mockResolvedValue(null);

      await expect(service.logReturnVisit('ft-x', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('creates a visit with provided eventId and notes', async () => {
      const ft = { id: 'ft-1' };
      mockFirstTimerRepo.findOne.mockResolvedValue(ft);
      const visit = {
        id: 'v-1',
        visitedAt: '2026-06-30',
        notes: 'Came back!',
        event: { id: 'evt-1' },
      };
      mockVisitRepo.create.mockReturnValue(visit);
      mockVisitRepo.save.mockResolvedValue(visit);

      const result = await service.logReturnVisit('ft-1', {
        eventId: 'evt-1',
        notes: 'Came back!',
        visitedAt: '2026-06-30',
      });

      expect(mockVisitRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          firstTimer: ft,
          visitedAt: '2026-06-30',
          notes: 'Came back!',
        }),
      );
      expect(result.id).toBe('v-1');
    });

    it('defaults visitedAt to today when not provided', async () => {
      const ft = { id: 'ft-1' };
      mockFirstTimerRepo.findOne.mockResolvedValue(ft);
      mockVisitRepo.create.mockImplementation((v: any) => v);
      mockVisitRepo.save.mockImplementation((v: any) => Promise.resolve(v));

      await service.logReturnVisit('ft-1', {});

      const createCall = mockVisitRepo.create.mock.calls[0][0];
      expect(createCall.visitedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  // ── getFirstTimerPipeline ─────────────────────────────────────────────────

  describe('getFirstTimerPipeline', () => {
    it('returns zeroed counts when no first-timers exist', async () => {
      mockDataSource.query = jest.fn().mockResolvedValue([
        {
          total: '0',
          converted: '0',
          invited: '0',
          returned: '0',
          contacted: '0',
          untouched: '0',
        },
      ]);

      const result = await service.getFirstTimerPipeline();

      expect(result).toEqual({
        total: 0,
        converted: 0,
        invited: 0,
        returned: 0,
        contacted: 0,
        untouched: 0,
      });
    });

    it('maps string counts to numbers correctly', async () => {
      mockDataSource.query = jest.fn().mockResolvedValue([
        {
          total: '20',
          converted: '5',
          invited: '3',
          returned: '4',
          contacted: '6',
          untouched: '2',
        },
      ]);

      const result = await service.getFirstTimerPipeline();

      expect(result.total).toBe(20);
      expect(result.converted).toBe(5);
      expect(result.contacted).toBe(6);
    });

    it('passes from/to params to SQL', async () => {
      const queryFn = jest.fn().mockResolvedValue([
        {
          total: '0',
          converted: '0',
          invited: '0',
          returned: '0',
          contacted: '0',
          untouched: '0',
        },
      ]);
      mockDataSource.query = queryFn;

      await service.getFirstTimerPipeline('2026-01-01', '2026-06-30');

      const [, params] = queryFn.mock.calls[0];
      expect(params).toContain('2026-01-01');
      expect(params).toContain('2026-06-30');
    });
  });

  // ── getStaleTasks ─────────────────────────────────────────────────────────

  describe('getStaleTasks', () => {
    it('throws BadRequestException when page < 1', async () => {
      await expect(service.getStaleTasks(7, 0, 20)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('queries tasks with open status and lastActivityAt before cutoff', async () => {
      const qb = { ...qbMock };
      Object.keys(qb).forEach(
        (k) => ((qb as any)[k] = jest.fn().mockReturnThis()),
      );
      qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
      mockTaskRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getStaleTasks(7, 1, 20);

      expect(qb.where).toHaveBeenCalledWith(
        expect.stringContaining('status IN'),
        expect.anything(),
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('lastActivityAt'),
        expect.objectContaining({ cutoff: expect.any(Date) }),
      );
      expect(result.data).toHaveLength(0);
      expect(result.totalCount).toBe(0);
    });

    it('returns paginated stale tasks', async () => {
      const staleTask = {
        id: 'task-1',
        status: FollowUpTaskStatusEnum.PENDING,
        lastActivityAt: new Date(0),
      };
      const qb = { ...qbMock };
      Object.keys(qb).forEach(
        (k) => ((qb as any)[k] = jest.fn().mockReturnThis()),
      );
      qb.getManyAndCount = jest.fn().mockResolvedValue([[staleTask], 1]);
      mockTaskRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getStaleTasks(7, 1, 20);

      expect(result.data).toHaveLength(1);
      expect(result.totalCount).toBe(1);
      expect(result.data[0].id).toBe('task-1');
    });
  });

  // ── getPublicEvents ────────────────────────────────────────────────────

  describe('getPublicEvents', () => {
    it('filters to events happening today when no search term is given', async () => {
      eventQbMock.getMany.mockResolvedValueOnce([
        { id: 'ev-1', name: 'Sunday Service', eventDate: new Date() },
      ]);

      const result = await service.getPublicEvents();

      expect(eventQbMock.where).toHaveBeenCalledWith(
        expect.stringContaining('eventDate <='),
        expect.objectContaining({ today: expect.any(Date) }),
      );
      expect(eventQbMock.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('endDate >='),
        expect.objectContaining({ today: expect.any(Date) }),
      );
      expect(result).toEqual([
        { id: 'ev-1', name: 'Sunday Service', eventDate: expect.any(Date) },
      ]);
    });

    it('searches by name instead of the today window when a search term is given', async () => {
      eventQbMock.getMany.mockResolvedValueOnce([]);

      await service.getPublicEvents('youth');

      expect(eventQbMock.where).toHaveBeenCalledWith(
        expect.stringContaining('name ILIKE'),
        { search: '%youth%' },
      );
      expect(eventQbMock.andWhere).not.toHaveBeenCalled();
    });

    it('treats a blank search string as no search', async () => {
      eventQbMock.getMany.mockResolvedValueOnce([]);

      await service.getPublicEvents('   ');

      expect(eventQbMock.where).toHaveBeenCalledWith(
        expect.stringContaining('eventDate <='),
        expect.anything(),
      );
    });
  });

  // ── getFirstTimers — visitCount aggregation ───────────────────────────

  describe('getFirstTimers visitCount', () => {
    it('rolls up the initial visit, logged visits, and Sunday School check-ins into visitCount', async () => {
      const ftA = { id: 'ft-a', visitCount: 2 }; // 2 logged visits from loadRelationCountAndMap
      const ftB = { id: 'ft-b', visitCount: 0 }; // no logged visits
      firstTimersListQbMock.getManyAndCount.mockResolvedValueOnce([
        [ftA, ftB],
        2,
      ]);
      ssaQbMock.getRawMany.mockResolvedValueOnce([
        { firstTimerId: 'ft-a', count: '3' },
      ]);

      const result = await service.getFirstTimers();

      expect(
        firstTimersListQbMock.loadRelationCountAndMap,
      ).toHaveBeenCalledWith('ft.visitCount', 'ft.visits');
      // ft-a: 1 (initial) + 2 (logged) + 3 (Sunday School) = 6
      expect(result.data[0].visitCount).toBe(6);
      // ft-b: 1 (initial) + 0 (logged) + 0 (Sunday School) = 1
      expect(result.data[1].visitCount).toBe(1);
    });

    it('skips the Sunday School batch query when the page is empty', async () => {
      firstTimersListQbMock.getManyAndCount.mockResolvedValueOnce([[], 0]);

      await service.getFirstTimers();

      expect(
        mockSundaySchoolAttendanceRepo.createQueryBuilder,
      ).not.toHaveBeenCalled();
    });
  });

  // ── getFirstTimerDetail / getFirstTimerDetailForWorker ─────────────────

  describe('getFirstTimerDetail', () => {
    it('throws NotFoundException when the first-timer does not exist', async () => {
      mockFirstTimerRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.getFirstTimerDetail('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('builds a dated timeline from the initial visit, logged visits, and Sunday School check-ins', async () => {
      mockFirstTimerRepo.findOne.mockResolvedValueOnce({
        id: 'ft-1',
        createdAt: new Date('2026-01-01T09:00:00Z'),
        visitedEvent: { name: 'Sunday Service' },
        visits: [
          {
            visitedAt: '2026-01-08',
            notes: 'Came back with a friend',
            event: { name: 'Sunday Service' },
          },
        ],
      });
      mockSundaySchoolAttendanceRepo.find.mockResolvedValueOnce([
        {
          markedAt: new Date('2026-01-15T09:00:00Z'),
          session: {
            sessionDate: '2026-01-15',
            sundaySchoolClass: { name: 'Kids Class' },
          },
        },
      ]);

      const result = await service.getFirstTimerDetail('ft-1');

      expect(result.visitCount).toBe(3);
      expect(result.timeline.map((t) => t.source)).toEqual([
        'INITIAL_VISIT',
        'LOGGED_VISIT',
        'SUNDAY_SCHOOL',
      ]);
      expect(result.timeline[2].label).toBe('Kids Class');
    });
  });

  describe('getFirstTimerDetailForWorker', () => {
    it('propagates ForbiddenException from the department check before loading anything', async () => {
      mockDepartmentAccessService.assertHasCapability.mockRejectedValueOnce(
        new ForbiddenException(
          'Access restricted to Follow-Up department workers',
        ),
      );

      await expect(
        service.getFirstTimerDetailForWorker('ft-1', 'member-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockFirstTimerRepo.findOne).not.toHaveBeenCalled();
    });

    it('delegates to getFirstTimerDetail once authorized', async () => {
      mockFirstTimerRepo.findOne.mockResolvedValueOnce({
        id: 'ft-1',
        createdAt: new Date('2026-01-01T09:00:00Z'),
        visitedEvent: null,
        visits: [],
      });

      const result = await service.getFirstTimerDetailForWorker(
        'ft-1',
        'member-1',
      );

      expect(result.visitCount).toBe(1);
    });
  });
});
