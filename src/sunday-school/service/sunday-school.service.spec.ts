import { SundaySchoolSettingsService } from './sunday-school-settings.service';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { SundaySchoolService, seriesDates } from './sunday-school.service';
import { SundaySchoolClass } from '../entity/sunday-school-class.entity';
import { SundaySchoolMember } from '../entity/sunday-school-member.entity';
import { SundaySchoolSession } from '../entity/sunday-school-session.entity';
import { SundaySchoolAttendance } from '../entity/sunday-school-attendance.entity';
import { SundaySchoolQuestion } from '../entity/sunday-school-question.entity';
import { SundaySchoolAttendanceStatus } from '../enums/sunday-school-attendance-status.enum';
import { Member } from '../../member/entity/member.entity';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { DepartmentCapability } from '../../department/enums/department-capability.enum';
import { DepartmentAccessService } from '../../department/service/department-access.service';
import { CacheService } from '../../utility/service/cache.service';
import { NotificationDispatchService } from '../../utility/service/notification-dispatch.service';
import { SessionSurface } from '../../auth/enum/session-surface.enum';
import { FollowUpService } from '../../follow-up/service/follow-up.service';

const mockClassRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  remove: jest.fn(),
};

const mockMembersCountQueryBuilder = {
  innerJoin: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  getRawMany: jest.fn().mockResolvedValue([]),
};

const mockMemberAssignRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  find: jest.fn(),
  remove: jest.fn(),
  count: jest.fn().mockResolvedValue(0),
  createQueryBuilder: jest.fn().mockReturnValue(mockMembersCountQueryBuilder),
};

const mockSessionRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  existsBy: jest.fn(),
  find: jest.fn(),
  count: jest.fn().mockResolvedValue(0),
};

const mockAttendanceRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  manager: {
    transaction: jest.fn(),
  },
};

const mockSettings = {
  isOneClassPerMember: jest.fn(),
  assertTeachersCanAddMembers: jest.fn(),
  assertTeachersCanCheckInFirstTimers: jest.fn(),
  teacherMarkingDays: jest.fn(),
};

const mockMemberEmailQb = {
  select: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue([]),
};
const mockMemberRepo = {
  existsBy: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue([]),
  createQueryBuilder: jest.fn(() => mockMemberEmailQb),
};

const mockQuestionRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  remove: jest.fn(),
};

const mockDepartmentAccessService = {
  hasCapability: jest.fn(),
  assertHasCapability: jest.fn(),
  findMemberIdsWithCapability: jest.fn().mockResolvedValue([]),
};

const mockNotificationDispatchService = {
  notifyMember: jest.fn().mockResolvedValue(undefined),
};

const mockFollowUpService = {
  createFirstTimerFromSundaySchoolCheckIn: jest.fn(),
};

const adminUser = {
  id: 'admin-1',
  role: MemberRoleEnum.WORKER,
  requiresPasswordChange: false,
  surface: SessionSurface.MEMBER,
};
const ssWorkerUser = {
  id: 'ss-worker-1',
  role: MemberRoleEnum.WORKER,
  requiresPasswordChange: false,
  surface: SessionSurface.MEMBER,
};
const otherWorkerUser = {
  id: 'other-worker-1',
  role: MemberRoleEnum.WORKER,
  requiresPasswordChange: false,
  surface: SessionSurface.MEMBER,
};
const memberUser = {
  id: 'member-1',
  role: MemberRoleEnum.MEMBER,
  requiresPasswordChange: false,
  surface: SessionSurface.MEMBER,
};

const mockClass = {
  id: 'class-1',
  name: 'Beginners',
  teacher: { id: 'ss-worker-1' },
};
const futureDate = new Date(Date.now() + 30 * 60 * 1000);
const mockSession = {
  id: 'session-1',
  sessionDate: '2026-06-08',
  selfMarkClosesAt: futureDate,
  sundaySchoolClass: mockClass,
};

describe('SundaySchoolService', () => {
  let service: SundaySchoolService;

  beforeEach(async () => {
    jest.resetAllMocks();
    mockSettings.isOneClassPerMember.mockResolvedValue(false);
    mockSettings.assertTeachersCanAddMembers.mockResolvedValue(undefined);
    // Fixtures use fixed past dates; keep the teacher marking window wide unless a test narrows it.
    mockSettings.teacherMarkingDays.mockResolvedValue(10000);
    mockSettings.assertTeachersCanCheckInFirstTimers.mockResolvedValue(
      undefined,
    );

    mockMembersCountQueryBuilder.innerJoin.mockReturnThis();
    mockMembersCountQueryBuilder.select.mockReturnThis();
    mockMembersCountQueryBuilder.addSelect.mockReturnThis();
    mockMembersCountQueryBuilder.where.mockReturnThis();
    mockMembersCountQueryBuilder.groupBy.mockReturnThis();
    mockMembersCountQueryBuilder.getRawMany.mockResolvedValue([]);
    mockMemberAssignRepo.createQueryBuilder.mockReturnValue(
      mockMembersCountQueryBuilder,
    );
    mockDepartmentAccessService.findMemberIdsWithCapability.mockResolvedValue(
      [],
    );
    mockNotificationDispatchService.notifyMember.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SundaySchoolService,
        {
          provide: getRepositoryToken(SundaySchoolClass),
          useValue: mockClassRepo,
        },
        {
          provide: getRepositoryToken(SundaySchoolMember),
          useValue: mockMemberAssignRepo,
        },
        {
          provide: getRepositoryToken(SundaySchoolSession),
          useValue: mockSessionRepo,
        },
        {
          provide: getRepositoryToken(SundaySchoolAttendance),
          useValue: mockAttendanceRepo,
        },
        { provide: getRepositoryToken(Member), useValue: mockMemberRepo },
        {
          provide: getRepositoryToken(SundaySchoolQuestion),
          useValue: mockQuestionRepo,
        },
        {
          provide: DepartmentAccessService,
          useValue: mockDepartmentAccessService,
        },
        {
          provide: NotificationDispatchService,
          useValue: mockNotificationDispatchService,
        },
        {
          provide: CacheService,
          useValue: {
            get: jest.fn().mockResolvedValue(undefined),
            set: jest.fn().mockResolvedValue(undefined),
            del: jest.fn().mockResolvedValue(1),
            key: jest.fn(),
          },
        },
        { provide: FollowUpService, useValue: mockFollowUpService },
        { provide: SundaySchoolSettingsService, useValue: mockSettings },
      ],
    }).compile();

    service = module.get<SundaySchoolService>(SundaySchoolService);
  });

  // ─── Authorization ───────────────────────────────────────────────────────

  describe('requireSundaySchoolAuth (via createClass)', () => {
    it('admin worker in SS dept is authorized', async () => {
      mockDepartmentAccessService.hasCapability.mockResolvedValue(true);
      mockClassRepo.create.mockReturnValue(mockClass);
      mockClassRepo.save.mockResolvedValue(mockClass);

      await expect(
        service.createClass(adminUser, { name: 'Alpha' }),
      ).resolves.not.toThrow();
    });

    it('Sunday School dept worker is authorized', async () => {
      mockDepartmentAccessService.hasCapability.mockResolvedValue(true);
      mockClassRepo.create.mockReturnValue(mockClass);
      mockClassRepo.save.mockResolvedValue(mockClass);

      await expect(
        service.createClass(ssWorkerUser, { name: 'Alpha' }),
      ).resolves.not.toThrow();
    });

    it('Worker whose secondary department is Sunday School is authorized', async () => {
      mockDepartmentAccessService.hasCapability.mockResolvedValue(true);
      mockClassRepo.create.mockReturnValue(mockClass);
      mockClassRepo.save.mockResolvedValue(mockClass);

      await expect(
        service.createClass(ssWorkerUser, { name: 'Alpha' }),
      ).resolves.not.toThrow();
    });

    it('Worker from another dept without class teacher role is rejected', async () => {
      mockDepartmentAccessService.hasCapability.mockResolvedValue(false);

      await expect(
        service.createClass(otherWorkerUser, { name: 'Alpha' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('checks the SUNDAY_SCHOOL key via DepartmentAccessService', async () => {
      mockDepartmentAccessService.hasCapability.mockResolvedValue(true);
      mockClassRepo.create.mockReturnValue(mockClass);
      mockClassRepo.save.mockResolvedValue(mockClass);

      await service.createClass(ssWorkerUser, { name: 'Alpha' });

      expect(mockDepartmentAccessService.hasCapability).toHaveBeenCalledWith(
        ssWorkerUser.id,
        DepartmentCapability.MANAGE_SUNDAY_SCHOOL,
      );
    });
  });

  describe('requireSundaySchoolAuth (via assignMember — class teacher fallback)', () => {
    it('Class teacher from another dept is authorized for their own class', async () => {
      // otherWorkerUser is NOT in SS dept, but IS the teacher of class-1
      mockDepartmentAccessService.hasCapability.mockResolvedValue(false);
      // isClassTeacher: findOne returns the class when teacher.id matches
      mockClassRepo.findOne
        .mockResolvedValueOnce(mockClass) // requireSundaySchoolAuth → isClassTeacher
        .mockResolvedValueOnce(mockClass); // actual class lookup in assignMember

      mockMemberRepo.existsBy.mockResolvedValue(true);
      mockMemberAssignRepo.findOne.mockResolvedValue(null);
      const assignment = { id: 'assign-1' };
      mockMemberAssignRepo.create.mockReturnValue(assignment);
      mockMemberAssignRepo.save.mockResolvedValue(assignment);

      await expect(
        service.assignMember(otherWorkerUser, 'class-1', {
          memberId: 'member-1',
        }),
      ).resolves.not.toThrow();
    });

    it('Class teacher from another dept is rejected for a different class', async () => {
      mockDepartmentAccessService.hasCapability.mockResolvedValue(false);
      // isClassTeacher: findOne returns null — not the teacher of class-2
      mockClassRepo.findOne.mockResolvedValue(null);

      await expect(
        service.assignMember(otherWorkerUser, 'class-2', {
          memberId: 'member-1',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── createClass ─────────────────────────────────────────────────────────

  describe('createClass', () => {
    beforeEach(() => {
      mockDepartmentAccessService.hasCapability.mockResolvedValue(true);
    });

    it('should create and save a class', async () => {
      const dto = { name: 'Beginners', description: 'Intro' };
      mockClassRepo.create.mockReturnValue({ ...dto, teacher: null });
      mockClassRepo.save.mockResolvedValue({ id: 'class-1', ...dto });

      const result = await service.createClass(ssWorkerUser, dto as any);

      expect(mockClassRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Beginners',
          description: 'Intro',
          teacher: null,
        }),
      );
      expect(result.id).toBe('class-1');
    });

    it('should set teacher reference when teacherId is provided', async () => {
      const dto = { name: 'Intermediates', teacherId: 'member-99' };
      mockMemberRepo.existsBy.mockResolvedValue(true);
      mockClassRepo.create.mockReturnValue({ ...dto });
      mockClassRepo.save.mockResolvedValue({ id: 'class-2', ...dto });

      await service.createClass(ssWorkerUser, dto as any);

      expect(mockClassRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ teacher: { id: 'member-99' } }),
      );
    });

    it('should throw NotFoundException when teacherId does not reference a real member', async () => {
      mockMemberRepo.existsBy.mockResolvedValue(false);

      await expect(
        service.createClass(ssWorkerUser, {
          name: 'Intermediates',
          teacherId: 'ghost-member',
        } as any),
      ).rejects.toThrow(NotFoundException);
      expect(mockClassRepo.save).not.toHaveBeenCalled();
    });

    it('new class starts with membersCount 0', async () => {
      const dto = { name: 'Beginners' };
      mockClassRepo.create.mockReturnValue({ ...dto, teacher: null });
      mockClassRepo.save.mockResolvedValue({ id: 'class-1', ...dto });

      const result = await service.createClass(ssWorkerUser, dto as any);

      expect(result.membersCount).toBe(0);
    });
  });

  // ─── updateClass ─────────────────────────────────────────────────────────

  describe('updateClass', () => {
    beforeEach(() => {
      mockDepartmentAccessService.hasCapability.mockResolvedValue(true);
    });

    it('should throw NotFoundException when class does not exist', async () => {
      mockClassRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateClass(ssWorkerUser, 'bad-id', { name: 'New' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update class fields and save', async () => {
      const entity = {
        id: 'class-1',
        name: 'Old',
        description: null,
        teacher: null,
      };
      mockClassRepo.findOne.mockResolvedValue(entity);
      mockClassRepo.save.mockImplementation((e) => Promise.resolve(e));
      mockMemberRepo.existsBy.mockResolvedValue(true);

      const result = await service.updateClass(adminUser, 'class-1', {
        name: 'New',
        teacherId: 'member-5',
      });

      expect(result.name).toBe('New');
      expect(result.teacher).toEqual({ id: 'member-5' });
    });

    it('should throw NotFoundException when the new teacherId does not reference a real member', async () => {
      mockMemberRepo.existsBy.mockResolvedValue(false);

      await expect(
        service.updateClass(adminUser, 'class-1', { teacherId: 'ghost' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockClassRepo.save).not.toHaveBeenCalled();
    });
  });

  // ─── deleteClass ─────────────────────────────────────────────────────────

  describe('deleteClass', () => {
    it('should throw NotFoundException when class does not exist', async () => {
      mockClassRepo.findOne.mockResolvedValue(null);

      await expect(service.deleteClass('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should remove the class', async () => {
      mockClassRepo.findOne.mockResolvedValue(mockClass);
      mockClassRepo.remove.mockResolvedValue(undefined);

      await service.deleteClass('class-1');

      expect(mockClassRepo.remove).toHaveBeenCalledWith(mockClass);
    });
  });

  // ─── getAllClasses ────────────────────────────────────────────────────────

  describe('getAllClasses', () => {
    it('should return paginated classes', async () => {
      mockClassRepo.findAndCount.mockResolvedValue([[mockClass], 1]);

      const result = await service.getAllClasses(1, 20);

      expect(result.data).toHaveLength(1);
      expect(result.totalCount).toBe(1);
    });

    it('attaches the real membersCount from the grouped query', async () => {
      mockClassRepo.findAndCount.mockResolvedValue([[mockClass], 1]);
      mockMembersCountQueryBuilder.getRawMany.mockResolvedValue([
        { classId: 'class-1', count: '3' },
      ]);

      const result = await service.getAllClasses(1, 20);

      expect(result.data[0].membersCount).toBe(3);
    });

    it('defaults membersCount to 0 for a class with no assignments', async () => {
      mockClassRepo.findAndCount.mockResolvedValue([[mockClass], 1]);
      mockMembersCountQueryBuilder.getRawMany.mockResolvedValue([]);

      const result = await service.getAllClasses(1, 20);

      expect(result.data[0].membersCount).toBe(0);
    });
  });

  // ─── assignMember ─────────────────────────────────────────────────────────

  describe('assignMember', () => {
    beforeEach(() => {
      mockDepartmentAccessService.hasCapability.mockResolvedValue(true);
    });

    it('should throw NotFoundException when class not found', async () => {
      mockClassRepo.findOne.mockResolvedValue(null);

      await expect(
        service.assignMember(ssWorkerUser, 'bad-class', {
          memberId: 'member-1',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when member not found', async () => {
      mockClassRepo.findOne.mockResolvedValue(mockClass);
      mockMemberRepo.existsBy.mockResolvedValue(false);

      await expect(
        service.assignMember(ssWorkerUser, 'class-1', {
          memberId: 'bad-member',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when member already assigned', async () => {
      mockClassRepo.findOne.mockResolvedValue(mockClass);
      mockMemberRepo.existsBy.mockResolvedValue(true);
      mockMemberAssignRepo.findOne.mockResolvedValue({ id: 'assign-1' });

      await expect(
        service.assignMember(ssWorkerUser, 'class-1', { memberId: 'member-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create and return the assignment', async () => {
      mockClassRepo.findOne.mockResolvedValue(mockClass);
      mockMemberRepo.existsBy.mockResolvedValue(true);
      mockMemberAssignRepo.findOne.mockResolvedValue(null);
      const assignment = { id: 'assign-1' };
      mockMemberAssignRepo.create.mockReturnValue(assignment);
      mockMemberAssignRepo.save.mockResolvedValue(assignment);

      const result = await service.assignMember(ssWorkerUser, 'class-1', {
        memberId: 'member-1',
      });

      expect(result).toEqual(assignment);
    });
  });

  // ─── removeMember ─────────────────────────────────────────────────────────

  describe('removeMember', () => {
    beforeEach(() => {
      mockDepartmentAccessService.hasCapability.mockResolvedValue(true);
    });

    it('should throw NotFoundException when assignment not found', async () => {
      mockMemberAssignRepo.findOne.mockResolvedValue(null);

      await expect(
        service.removeMember(ssWorkerUser, 'class-1', 'member-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should remove the assignment', async () => {
      const assignment = { id: 'assign-1' };
      mockMemberAssignRepo.findOne.mockResolvedValue(assignment);
      mockMemberAssignRepo.remove.mockResolvedValue(undefined);

      await service.removeMember(ssWorkerUser, 'class-1', 'member-1');

      expect(mockMemberAssignRepo.remove).toHaveBeenCalledWith(assignment);
    });
  });

  // ─── createSession ────────────────────────────────────────────────────────

  describe('createSession', () => {
    beforeEach(() => {
      mockDepartmentAccessService.hasCapability.mockResolvedValue(true);
    });

    it('should throw NotFoundException when class not found', async () => {
      mockClassRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createSession(ssWorkerUser, {
          classId: 'bad',
          sessionDate: '2026-06-08',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when session already exists', async () => {
      mockClassRepo.findOne.mockResolvedValue(mockClass);
      mockSessionRepo.findOne.mockResolvedValue({ id: 'session-existing' });

      await expect(
        service.createSession(ssWorkerUser, {
          classId: 'class-1',
          sessionDate: '2026-06-08',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create and return the session with selfMarkClosesAt null', async () => {
      mockClassRepo.findOne.mockResolvedValue(mockClass);
      mockSessionRepo.findOne.mockResolvedValue(null);
      const session = {
        id: 'session-1',
        sessionDate: '2026-06-08',
        selfMarkClosesAt: null,
      };
      mockSessionRepo.create.mockReturnValue(session);
      mockSessionRepo.save.mockResolvedValue(session);

      const result = await service.createSession(ssWorkerUser, {
        classId: 'class-1',
        sessionDate: '2026-06-08',
      });

      expect(result.selfMarkClosesAt).toBeNull();
      expect(result.selfMarkOpen).toBe(false);
    });

    it('should throw ForbiddenException for unauthorized worker', async () => {
      mockDepartmentAccessService.hasCapability.mockResolvedValue(false);
      mockClassRepo.findOne.mockResolvedValue(null); // not the teacher either

      await expect(
        service.createSession(otherWorkerUser, {
          classId: 'class-1',
          sessionDate: '2026-06-08',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should turn a concurrent unique-violation into a friendly ConflictException', async () => {
      mockClassRepo.findOne.mockResolvedValue(mockClass);
      mockSessionRepo.findOne.mockResolvedValue(null); // pre-check race: passes
      mockSessionRepo.create.mockReturnValue({
        sessionDate: '2026-06-08',
        sundaySchoolClass: mockClass,
      });
      const dbError = Object.assign(Object.create(QueryFailedError.prototype), {
        driverError: { code: '23505' },
      });
      mockSessionRepo.save.mockRejectedValue(dbError);

      await expect(
        service.createSession(ssWorkerUser, {
          classId: 'class-1',
          sessionDate: '2026-06-08',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── openSelfMark / closeSelfMark ─────────────────────────────────────────

  describe('openSelfMark', () => {
    beforeEach(() => {
      mockDepartmentAccessService.hasCapability.mockResolvedValue(true);
    });

    it('should throw NotFoundException when session not found', async () => {
      mockSessionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.openSelfMark(ssWorkerUser, 'bad-id', 30),
      ).rejects.toThrow(NotFoundException);
    });

    it('should set selfMarkClosesAt to now + closesInMinutes', async () => {
      const session = {
        id: 'session-1',
        sessionDate: '2026-06-08',
        selfMarkClosesAt: null,
        sundaySchoolClass: mockClass,
      };
      mockSessionRepo.findOne.mockResolvedValue(session);
      mockSessionRepo.save.mockImplementation((e) => Promise.resolve(e));

      const before = new Date();
      const result = await service.openSelfMark(ssWorkerUser, 'session-1', 30);
      const after = new Date();

      expect(result.selfMarkClosesAt).toBeInstanceOf(Date);
      const closesAtMs = new Date(result.selfMarkClosesAt).getTime();
      expect(closesAtMs).toBeGreaterThanOrEqual(
        before.getTime() + 29 * 60 * 1000,
      );
      expect(closesAtMs).toBeLessThanOrEqual(after.getTime() + 31 * 60 * 1000);
      expect(result.selfMarkOpen).toBe(true);
    });

    it('pushes "check-in is open" to class members not yet marked', async () => {
      mockSessionRepo.findOne.mockResolvedValue({
        id: 'session-1',
        sessionDate: '2026-06-08',
        selfMarkClosesAt: null,
        sundaySchoolClass: mockClass,
      });
      mockSessionRepo.save.mockImplementation((e) => Promise.resolve(e));
      mockMemberAssignRepo.find.mockResolvedValue([
        { member: { id: 'm1' } },
        { member: { id: 'm2' } },
      ]);
      mockAttendanceRepo.find.mockResolvedValue([{ member: { id: 'm2' } }]);
      mockNotificationDispatchService.notifyMember.mockResolvedValue(undefined);

      await service.openSelfMark(ssWorkerUser, 'session-1', 30);

      expect(mockNotificationDispatchService.notifyMember).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'SUNDAY_SCHOOL_ATTENDANCE',
          push: expect.objectContaining({
            memberIds: ['m1'],
            key: 'SUNDAY_SCHOOL_CHECKIN_OPEN',
            vars: expect.objectContaining({ class_name: mockClass.name }),
          }),
        }),
      );
    });

    it('still opens check-in when the push fails', async () => {
      mockSessionRepo.findOne.mockResolvedValue({
        id: 'session-1',
        sessionDate: '2026-06-08',
        selfMarkClosesAt: null,
        sundaySchoolClass: mockClass,
      });
      mockSessionRepo.save.mockImplementation((e) => Promise.resolve(e));
      mockMemberAssignRepo.find.mockResolvedValue([{ member: { id: 'm1' } }]);
      mockAttendanceRepo.find.mockResolvedValue([]);
      mockNotificationDispatchService.notifyMember.mockRejectedValue(
        new Error('push down'),
      );

      const result = await service.openSelfMark(ssWorkerUser, 'session-1', 30);
      expect(result.selfMarkOpen).toBe(true);
    });
  });

  describe('closeSelfMark', () => {
    beforeEach(() => {
      mockDepartmentAccessService.hasCapability.mockResolvedValue(true);
    });

    it('should throw NotFoundException when session not found', async () => {
      mockSessionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.closeSelfMark(ssWorkerUser, 'bad-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should set selfMarkClosesAt to null', async () => {
      const session = {
        id: 'session-1',
        selfMarkClosesAt: futureDate,
        sundaySchoolClass: mockClass,
      };
      mockSessionRepo.findOne.mockResolvedValue(session);
      mockSessionRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.closeSelfMark(ssWorkerUser, 'session-1');

      expect(result.selfMarkClosesAt).toBeNull();
      expect(result.selfMarkOpen).toBe(false);
    });
  });

  // ─── selfMarkPresent ──────────────────────────────────────────────────────

  describe('selfMarkPresent', () => {
    it('should throw NotFoundException when session not found', async () => {
      mockSessionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.selfMarkPresent(memberUser, 'bad-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when self-marking is closed', async () => {
      mockSessionRepo.findOne.mockResolvedValue({
        ...mockSession,
        selfMarkClosesAt: null,
      });

      await expect(
        service.selfMarkPresent(memberUser, 'session-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ForbiddenException when member is not in the class', async () => {
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
      mockMemberAssignRepo.findOne.mockResolvedValue(null);

      await expect(
        service.selfMarkPresent(memberUser, 'session-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when already marked PRESENT', async () => {
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
      mockMemberAssignRepo.findOne.mockResolvedValue({ id: 'assign-1' });
      mockAttendanceRepo.findOne.mockResolvedValue({
        id: 'att-1',
        status: SundaySchoolAttendanceStatus.PRESENT,
      });

      await expect(
        service.selfMarkPresent(memberUser, 'session-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should update existing ABSENT record to PRESENT and refresh markedAt', async () => {
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
      mockMemberAssignRepo.findOne.mockResolvedValue({ id: 'assign-1' });
      const staleMarkedAt = new Date('2020-01-01T00:00:00Z');
      const existingAtt = {
        id: 'att-1',
        status: SundaySchoolAttendanceStatus.ABSENT,
        markedByTeacher: true,
        markedAt: staleMarkedAt,
      };
      mockAttendanceRepo.findOne.mockResolvedValue(existingAtt);
      mockAttendanceRepo.save.mockImplementation((e) => Promise.resolve(e));

      const before = new Date();
      const result = await service.selfMarkPresent(memberUser, 'session-1');

      expect(result.status).toBe(SundaySchoolAttendanceStatus.PRESENT);
      expect(result.markedByTeacher).toBe(false);
      expect(result.markedAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
      expect(result.markedAt).not.toEqual(staleMarkedAt);
    });

    it('should create new PRESENT attendance record', async () => {
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
      mockMemberAssignRepo.findOne.mockResolvedValue({ id: 'assign-1' });
      mockAttendanceRepo.findOne.mockResolvedValue(null);
      const newAtt = {
        id: 'att-new',
        status: SundaySchoolAttendanceStatus.PRESENT,
        markedByTeacher: false,
      };
      mockAttendanceRepo.create.mockReturnValue(newAtt);
      mockAttendanceRepo.save.mockResolvedValue(newAtt);

      const result = await service.selfMarkPresent(memberUser, 'session-1');

      expect(mockAttendanceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: SundaySchoolAttendanceStatus.PRESENT,
          markedByTeacher: false,
        }),
      );
      expect(result.status).toBe(SundaySchoolAttendanceStatus.PRESENT);
    });
  });

  // ─── getOpenSessionsForMember ─────────────────────────────────────────────

  describe('getOpenSessionsForMember', () => {
    it('returns an empty array when the member has no class assignments', async () => {
      mockMemberAssignRepo.find.mockResolvedValue([]);

      const result = await service.getOpenSessionsForMember(memberUser);

      expect(result).toEqual([]);
      expect(mockSessionRepo.find).not.toHaveBeenCalled();
    });

    it('flags a session the member has already self-marked PRESENT for', async () => {
      mockMemberAssignRepo.find.mockResolvedValue([
        { sundaySchoolClass: { id: 'class-1' } },
      ]);
      mockSessionRepo.find.mockResolvedValue([
        { id: 'session-1', sundaySchoolClass: { id: 'class-1' } },
        { id: 'session-2', sundaySchoolClass: { id: 'class-1' } },
      ]);
      mockAttendanceRepo.find.mockResolvedValue([
        { session: { id: 'session-1' } },
      ]);

      const result = await service.getOpenSessionsForMember(memberUser);

      expect(result).toEqual([
        expect.objectContaining({ id: 'session-1', alreadyCheckedIn: true }),
        expect.objectContaining({ id: 'session-2', alreadyCheckedIn: false }),
      ]);
      expect(mockAttendanceRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: SundaySchoolAttendanceStatus.PRESENT,
          }),
        }),
      );
    });

    it('does not flag a session where the existing record is ABSENT/EXCUSED, not PRESENT', async () => {
      // selfMarkPresent() itself allows overwriting a non-PRESENT record —
      // only an existing PRESENT record blocks a second check-in — so the
      // "already checked in" flag must track that exact same distinction.
      mockMemberAssignRepo.find.mockResolvedValue([
        { sundaySchoolClass: { id: 'class-1' } },
      ]);
      mockSessionRepo.find.mockResolvedValue([
        { id: 'session-1', sundaySchoolClass: { id: 'class-1' } },
      ]);
      mockAttendanceRepo.find.mockResolvedValue([]);

      const result = await service.getOpenSessionsForMember(memberUser);

      expect(result).toEqual([
        expect.objectContaining({ id: 'session-1', alreadyCheckedIn: false }),
      ]);
    });

    it('skips the attendance lookup entirely when there are no open sessions', async () => {
      mockMemberAssignRepo.find.mockResolvedValue([
        { sundaySchoolClass: { id: 'class-1' } },
      ]);
      mockSessionRepo.find.mockResolvedValue([]);

      const result = await service.getOpenSessionsForMember(memberUser);

      expect(result).toEqual([]);
      expect(mockAttendanceRepo.find).not.toHaveBeenCalled();
    });
  });

  // ─── bulkMarkAttendance ───────────────────────────────────────────────────

  describe('bulkMarkAttendance', () => {
    beforeEach(() => {
      mockDepartmentAccessService.hasCapability.mockResolvedValue(true);
    });

    it('should throw NotFoundException when session not found', async () => {
      mockSessionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.bulkMarkAttendance(ssWorkerUser, 'bad-id', { attendances: [] }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should skip non-members silently', async () => {
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
      const mockTx = {
        find: jest
          .fn()
          .mockResolvedValueOnce([]) // validAssignments: none
          .mockResolvedValueOnce([]), // existing: none
        save: jest.fn(),
      };
      mockAttendanceRepo.manager.transaction.mockImplementation(
        async (cb: (em: typeof mockTx) => Promise<unknown>) => cb(mockTx),
      );

      const result = await service.bulkMarkAttendance(
        ssWorkerUser,
        'session-1',
        {
          attendances: [
            {
              memberId: 'non-member',
              status: SundaySchoolAttendanceStatus.PRESENT,
            },
          ],
        },
      );

      expect(result).toHaveLength(0);
      expect(mockTx.save).not.toHaveBeenCalled();
    });

    it('should update existing attendance records and refresh markedAt', async () => {
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
      const staleMarkedAt = new Date('2020-01-01T00:00:00Z');
      const existing = {
        id: 'att-1',
        status: SundaySchoolAttendanceStatus.ABSENT,
        markedByTeacher: false,
        markedAt: staleMarkedAt,
        member: { id: 'member-1' },
      };
      const mockTx = {
        find: jest
          .fn()
          .mockResolvedValueOnce([
            { id: 'assign-1', member: { id: 'member-1' } },
          ]) // validAssignments
          .mockResolvedValueOnce([existing]), // existing attendance
        save: jest
          .fn()
          .mockImplementation((_entity, arr) => Promise.resolve(arr)),
      };
      mockAttendanceRepo.manager.transaction.mockImplementation(
        async (cb: (em: typeof mockTx) => Promise<unknown>) => cb(mockTx),
      );

      const before = new Date();
      const result = await service.bulkMarkAttendance(
        ssWorkerUser,
        'session-1',
        {
          attendances: [
            {
              memberId: 'member-1',
              status: SundaySchoolAttendanceStatus.PRESENT,
            },
          ],
        },
      );

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe(SundaySchoolAttendanceStatus.PRESENT);
      expect(result[0].markedByTeacher).toBe(true);
      expect(result[0].markedAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
      expect(result[0].markedAt).not.toEqual(staleMarkedAt);
    });

    it('should throw ForbiddenException for unauthorized worker', async () => {
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
      mockDepartmentAccessService.hasCapability.mockResolvedValue(false);
      mockClassRepo.findOne.mockResolvedValue(null); // not teacher

      await expect(
        service.bulkMarkAttendance(otherWorkerUser, 'session-1', {
          attendances: [],
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── getSessionRoster ─────────────────────────────────────────────────────

  describe('getSessionRoster', () => {
    beforeEach(() => {
      mockDepartmentAccessService.hasCapability.mockResolvedValue(true);
    });

    it('should throw NotFoundException when session not found', async () => {
      mockSessionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getSessionRoster(ssWorkerUser, 'bad-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return roster with null status for unmarked members', async () => {
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
      const cm1 = {
        member: { id: 'member-1', firstname: 'John', lastname: 'Doe' },
      };
      const cm2 = {
        member: { id: 'member-2', firstname: 'Jane', lastname: 'Smith' },
      };
      mockMemberAssignRepo.find.mockResolvedValue([cm1, cm2]);
      mockAttendanceRepo.find.mockResolvedValue([
        {
          member: { id: 'member-1' },
          status: SundaySchoolAttendanceStatus.PRESENT,
          markedByTeacher: false,
          markedAt: new Date(),
        },
      ]);

      const result = await service.getSessionRoster(ssWorkerUser, 'session-1');

      expect(result.members).toHaveLength(2);
      const john = result.members.find((m) => m.memberId === 'member-1');
      const jane = result.members.find((m) => m.memberId === 'member-2');
      expect(john?.status).toBe(SundaySchoolAttendanceStatus.PRESENT);
      expect(jane?.status).toBeNull();
    });

    it('should return correct metadata', async () => {
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
      mockMemberAssignRepo.find.mockResolvedValue([]);
      mockAttendanceRepo.find.mockResolvedValue([]);

      const result = await service.getSessionRoster(ssWorkerUser, 'session-1');

      expect(result.sessionId).toBe('session-1');
      expect(result.sessionDate).toBe('2026-06-08');
      expect(result.selfMarkOpen).toBe(true);
      expect(result.classId).toBe('class-1');
    });

    it('does not crash on a first-timer check-in row (member null) and surfaces it separately', async () => {
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
      const cm1 = {
        member: { id: 'member-1', firstname: 'John', lastname: 'Doe' },
      };
      mockMemberAssignRepo.find.mockResolvedValue([cm1]);
      mockAttendanceRepo.find.mockResolvedValue([
        {
          id: 'att-1',
          member: { id: 'member-1' },
          firstTimer: null,
          status: SundaySchoolAttendanceStatus.PRESENT,
          markedByTeacher: true,
          markedAt: new Date(),
        },
        {
          id: 'att-2',
          member: null,
          firstTimer: { id: 'ft-1', firstname: 'Guest', lastname: 'Visitor' },
          status: SundaySchoolAttendanceStatus.PRESENT,
          markedByTeacher: true,
          markedAt: new Date('2026-06-08T10:00:00Z'),
        },
      ]);

      const result = await service.getSessionRoster(ssWorkerUser, 'session-1');

      expect(result.members).toHaveLength(1);
      expect(result.members[0].status).toBe(
        SundaySchoolAttendanceStatus.PRESENT,
      );
      expect(result.firstTimerCheckIns).toEqual([
        {
          attendanceId: 'att-2',
          firstTimerId: 'ft-1',
          name: 'Guest Visitor',
          markedAt: new Date('2026-06-08T10:00:00Z'),
        },
      ]);
    });
  });

  // ─── checkInFirstTimer ────────────────────────────────────────────────────

  describe('checkInFirstTimer', () => {
    beforeEach(() => {
      mockDepartmentAccessService.hasCapability.mockResolvedValue(true);
    });

    it('throws NotFoundException when session not found', async () => {
      mockSessionRepo.findOne.mockResolvedValue(null);
      await expect(
        service.checkInFirstTimer(ssWorkerUser, 'bad-id', {
          firstname: 'Guest',
          lastname: 'Visitor',
          phone: '08000000000',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates a FirstTimer via FollowUpService and marks them present', async () => {
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
      const firstTimer = {
        id: 'ft-1',
        firstname: 'Guest',
        lastname: 'Visitor',
      };
      mockFollowUpService.createFirstTimerFromSundaySchoolCheckIn.mockResolvedValue(
        firstTimer,
      );
      mockAttendanceRepo.create.mockImplementation((v) => v);
      mockAttendanceRepo.save.mockImplementation((v) =>
        Promise.resolve({ id: 'att-1', ...v }),
      );

      const result = await service.checkInFirstTimer(
        ssWorkerUser,
        'session-1',
        {
          firstname: 'Guest',
          lastname: 'Visitor',
          phone: '08000000000',
        },
      );

      expect(
        mockFollowUpService.createFirstTimerFromSundaySchoolCheckIn,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          firstname: 'Guest',
          lastname: 'Visitor',
          phone: '08000000000',
        }),
        { memberCreatorId: ssWorkerUser.id },
      );
      expect(mockAttendanceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          firstTimer,
          status: SundaySchoolAttendanceStatus.PRESENT,
          markedByTeacher: true,
        }),
      );
      expect(result.firstTimer).toEqual(firstTimer);
    });

    it('refuses teachers when the church has first-timer check-in set to admins only', async () => {
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
      mockDepartmentAccessService.hasCapability.mockResolvedValue(true);
      mockSettings.assertTeachersCanCheckInFirstTimers.mockRejectedValue(
        new ForbiddenException('admins only'),
      );

      await expect(
        service.checkInFirstTimer(ssWorkerUser, 'session-1', {
          firstname: 'Guest',
          lastname: 'Visitor',
          phone: '08000000000',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(
        mockFollowUpService.createFirstTimerFromSundaySchoolCheckIn,
      ).not.toHaveBeenCalled();
    });

    it('lets an admin check in a first-timer, recorded as created by the admin', async () => {
      mockSessionRepo.existsBy.mockResolvedValue(true);
      const firstTimer = { id: 'ft-2' };
      mockFollowUpService.createFirstTimerFromSundaySchoolCheckIn.mockResolvedValue(
        firstTimer,
      );
      mockAttendanceRepo.create.mockImplementation((v) => v);
      mockAttendanceRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await service.adminCheckInFirstTimer(
        'session-1',
        { firstname: 'Guest', lastname: 'Visitor', phone: '08000000000' },
        'admin-1',
      );

      expect(
        mockFollowUpService.createFirstTimerFromSundaySchoolCheckIn,
      ).toHaveBeenCalledWith(expect.anything(), { adminCreatorId: 'admin-1' });
      expect(
        mockSettings.assertTeachersCanCheckInFirstTimers,
      ).not.toHaveBeenCalled();
      expect(result.firstTimer).toEqual(firstTimer);
    });

    it('admin check-in 404s for an unknown session', async () => {
      mockSessionRepo.existsBy.mockResolvedValue(false);
      await expect(
        service.adminCheckInFirstTimer(
          'nope',
          { firstname: 'G', lastname: 'V', phone: '08000000000' },
          'admin-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a teacher with no authorization for this class', async () => {
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
      mockDepartmentAccessService.hasCapability.mockResolvedValue(false);
      mockClassRepo.findOne.mockResolvedValue(null);

      await expect(
        service.checkInFirstTimer(
          {
            id: 'random-member',
            role: MemberRoleEnum.WORKER,
            requiresPasswordChange: false,
            surface: SessionSurface.MEMBER,
          },
          'session-1',
          { firstname: 'Guest', lastname: 'Visitor', phone: '08000000000' },
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(
        mockFollowUpService.createFirstTimerFromSundaySchoolCheckIn,
      ).not.toHaveBeenCalled();
    });
  });

  // ─── getMyClasses ─────────────────────────────────────────────────────────

  describe('getMyClasses', () => {
    it('returns the classes the member is assigned to', async () => {
      mockMemberAssignRepo.find.mockResolvedValue([
        { sundaySchoolClass: mockClass },
        { sundaySchoolClass: { id: 'class-2', name: 'Teens' } },
      ]);

      const result = await service.getMyClasses(memberUser);

      expect(result).toEqual([
        { ...mockClass, teacher: { id: 'ss-worker-1' } },
        { id: 'class-2', name: 'Teens', teacher: null },
      ]);
    });

    it("only shares the teacher's name with members", async () => {
      mockMemberAssignRepo.find.mockResolvedValue([
        {
          sundaySchoolClass: {
            id: 'class-1',
            name: 'Juniors',
            meetingDay: 'SUNDAY',
            teacher: {
              id: 't1',
              firstname: 'Tunde',
              lastname: 'Bello',
              phoneNumber: '+2348000000000',
              email: 't@x.org',
            },
          },
        },
      ]);

      const [cls] = await service.getMyClasses(memberUser);

      expect(cls.teacher).toEqual({
        id: 't1',
        firstname: 'Tunde',
        lastname: 'Bello',
      });
      expect(cls.meetingDay).toBe('SUNDAY');
    });
  });

  // ─── askQuestion ──────────────────────────────────────────────────────────

  describe('askQuestion', () => {
    it('should throw NotFoundException when class not found', async () => {
      mockClassRepo.findOne.mockResolvedValue(null);

      await expect(
        service.askQuestion(memberUser, 'bad-id', {
          questionText: 'Why?',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when member is not assigned to the class', async () => {
      mockClassRepo.findOne.mockResolvedValue(mockClass);
      mockMemberAssignRepo.findOne.mockResolvedValue(null);

      await expect(
        service.askQuestion(memberUser, 'class-1', {
          questionText: 'Why?',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('notifies just the assigned teacher (email + push) when one exists', async () => {
      mockClassRepo.findOne.mockResolvedValue(mockClass); // teacher: { id: 'ss-worker-1' }
      mockMemberAssignRepo.findOne.mockResolvedValue({ id: 'assign-1' });
      const question = {
        id: 'q-1',
        questionText: 'Why?',
        sundaySchoolClass: mockClass,
      };
      mockQuestionRepo.create.mockReturnValue(question);
      mockQuestionRepo.save.mockResolvedValue(question);
      mockMemberRepo.findOne.mockImplementation(({ where: { id } }) => {
        if (id === memberUser.id)
          return Promise.resolve({
            id: memberUser.id,
            firstname: 'Jane',
            lastname: 'Doe',
          });
        if (id === 'ss-worker-1')
          return Promise.resolve({
            id: 'ss-worker-1',
            firstname: 'Teacher',
            lastname: 'Tom',
            email: 'teacher@example.com',
          });
        return Promise.resolve(null);
      });

      const result = await service.askQuestion(memberUser, 'class-1', {
        questionText: 'Why?',
      });

      expect(result).toBe(question);
      expect(mockNotificationDispatchService.notifyMember).toHaveBeenCalledWith(
        expect.objectContaining({
          email: expect.objectContaining({ to: 'teacher@example.com' }),
          push: expect.objectContaining({ memberIds: ['ss-worker-1'] }),
        }),
      );
      expect(
        mockDepartmentAccessService.findMemberIdsWithCapability,
      ).not.toHaveBeenCalled();
    });

    it('falls back to notifying every SS-capability worker (push only) when no teacher is assigned', async () => {
      const classWithoutTeacher = {
        id: 'class-1',
        name: 'Beginners',
        teacher: null,
      };
      mockClassRepo.findOne.mockResolvedValue(classWithoutTeacher);
      mockMemberAssignRepo.findOne.mockResolvedValue({ id: 'assign-1' });
      const question = {
        id: 'q-1',
        questionText: 'Why?',
        sundaySchoolClass: classWithoutTeacher,
      };
      mockQuestionRepo.create.mockReturnValue(question);
      mockQuestionRepo.save.mockResolvedValue(question);
      mockMemberRepo.findOne.mockResolvedValue({
        id: memberUser.id,
        firstname: 'Jane',
        lastname: 'Doe',
      });
      mockDepartmentAccessService.findMemberIdsWithCapability.mockResolvedValue(
        ['staff-1', 'staff-2'],
      );

      await service.askQuestion(memberUser, 'class-1', {
        questionText: 'Why?',
      });

      expect(
        mockDepartmentAccessService.findMemberIdsWithCapability,
      ).toHaveBeenCalledWith(DepartmentCapability.MANAGE_SUNDAY_SCHOOL);
      const call =
        mockNotificationDispatchService.notifyMember.mock.calls[0][0];
      expect(call.email).toBeUndefined();
      expect(call.push).toEqual(
        expect.objectContaining({ memberIds: ['staff-1', 'staff-2'] }),
      );
    });

    it('does not notify anyone when there is no teacher and no SS-capability staff', async () => {
      const classWithoutTeacher = {
        id: 'class-1',
        name: 'Beginners',
        teacher: null,
      };
      mockClassRepo.findOne.mockResolvedValue(classWithoutTeacher);
      mockMemberAssignRepo.findOne.mockResolvedValue({ id: 'assign-1' });
      const question = { id: 'q-1', questionText: 'Why?' };
      mockQuestionRepo.create.mockReturnValue(question);
      mockQuestionRepo.save.mockResolvedValue(question);
      mockMemberRepo.findOne.mockResolvedValue({ id: memberUser.id });
      mockDepartmentAccessService.findMemberIdsWithCapability.mockResolvedValue(
        [],
      );

      await service.askQuestion(memberUser, 'class-1', {
        questionText: 'Why?',
      });

      expect(
        mockNotificationDispatchService.notifyMember,
      ).not.toHaveBeenCalled();
    });
  });

  // ─── getMyQuestions ───────────────────────────────────────────────────────

  describe('getMyQuestions', () => {
    it('returns the member’s own questions, paginated', async () => {
      mockQuestionRepo.findAndCount.mockResolvedValue([[{ id: 'q-1' }], 1]);

      const result = await service.getMyQuestions(memberUser, 1, 20);

      expect(result.data).toHaveLength(1);
      expect(result.totalCount).toBe(1);
      expect(mockQuestionRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { askedBy: { id: memberUser.id } },
        }),
      );
    });
  });

  // ─── getQuestionsForClass ─────────────────────────────────────────────────

  describe('getQuestionsForClass', () => {
    it('should throw NotFoundException when class not found', async () => {
      mockClassRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getQuestionsForClass(ssWorkerUser, 'bad-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for unauthorized worker', async () => {
      // First call is the "class exists" check, second is isClassTeacher's
      // internal lookup — must differ so an unrelated worker isn't
      // accidentally treated as the teacher by a single blanket mock.
      mockClassRepo.findOne
        .mockResolvedValueOnce(mockClass)
        .mockResolvedValueOnce(null);
      mockDepartmentAccessService.hasCapability.mockResolvedValue(false);

      await expect(
        service.getQuestionsForClass(otherWorkerUser, 'class-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns paginated questions for an authorized worker', async () => {
      mockClassRepo.findOne.mockResolvedValue(mockClass);
      mockDepartmentAccessService.hasCapability.mockResolvedValue(true);
      mockQuestionRepo.findAndCount.mockResolvedValue([[{ id: 'q-1' }], 1]);

      const result = await service.getQuestionsForClass(
        ssWorkerUser,
        'class-1',
      );

      expect(result.data).toHaveLength(1);
    });
  });

  // ─── getAllQuestions (cross-class, SS staff only) ────────────────────────

  describe('getAllQuestions', () => {
    it('throws ForbiddenException for a worker without the SS capability', async () => {
      mockDepartmentAccessService.assertHasCapability.mockRejectedValue(
        new ForbiddenException(
          'Only Sunday School staff can view questions across all classes.',
        ),
      );

      await expect(service.getAllQuestions(otherWorkerUser)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockQuestionRepo.findAndCount).not.toHaveBeenCalled();
    });

    it('does not fall back to the class-teacher check — capability only', async () => {
      mockDepartmentAccessService.assertHasCapability.mockResolvedValue(
        undefined,
      );
      mockQuestionRepo.findAndCount.mockResolvedValue([[{ id: 'q-1' }], 1]);

      await service.getAllQuestions(ssWorkerUser);

      expect(
        mockDepartmentAccessService.assertHasCapability,
      ).toHaveBeenCalledWith(
        ssWorkerUser.id,
        DepartmentCapability.MANAGE_SUNDAY_SCHOOL,
        expect.any(String),
      );
      expect(mockClassRepo.findOne).not.toHaveBeenCalled();
    });

    it('returns questions across every class, most recent first', async () => {
      mockDepartmentAccessService.assertHasCapability.mockResolvedValue(
        undefined,
      );
      mockQuestionRepo.findAndCount.mockResolvedValue([
        [{ id: 'q-1' }, { id: 'q-2' }],
        2,
      ]);

      const result = await service.getAllQuestions(ssWorkerUser, 1, 20);

      expect(result.data).toHaveLength(2);
      expect(result.totalCount).toBe(2);
      expect(mockQuestionRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          relations: ['askedBy', 'sundaySchoolClass'],
          order: { createdAt: 'DESC' },
        }),
      );
      // No classId filter anywhere in the where clause — genuinely cross-class.
      const call = mockQuestionRepo.findAndCount.mock.calls[0][0];
      expect(call.where).toBeUndefined();
    });
  });

  describe('adminGetAllQuestions', () => {
    it('returns questions across every class without any capability check', async () => {
      mockQuestionRepo.findAndCount.mockResolvedValue([[{ id: 'q-1' }], 1]);

      const result = await service.adminGetAllQuestions(1, 20);

      expect(result.data).toHaveLength(1);
      expect(
        mockDepartmentAccessService.assertHasCapability,
      ).not.toHaveBeenCalled();
    });
  });

  // ─── answerQuestion ───────────────────────────────────────────────────────

  describe('answerQuestion', () => {
    it('should throw NotFoundException when question not found', async () => {
      mockQuestionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.answerQuestion(ssWorkerUser, 'bad-id', {
          answerText: 'Because...',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for unauthorized worker', async () => {
      mockQuestionRepo.findOne.mockResolvedValue({
        id: 'q-1',
        sundaySchoolClass: mockClass,
        askedBy: { id: 'member-1' },
      });
      mockDepartmentAccessService.hasCapability.mockResolvedValue(false);
      mockClassRepo.findOne.mockResolvedValue(null); // not the teacher either

      await expect(
        service.answerQuestion(otherWorkerUser, 'q-1', {
          answerText: 'Because...',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('answers the question and notifies the asking member', async () => {
      const question = {
        id: 'q-1',
        questionText: 'Why?',
        sundaySchoolClass: { id: 'class-1', name: 'Beginners' },
        askedBy: {
          id: 'member-1',
          firstname: 'Jane',
          email: 'jane@example.com',
        },
      };
      mockQuestionRepo.findOne.mockResolvedValue(question);
      mockDepartmentAccessService.hasCapability.mockResolvedValue(true);
      mockQuestionRepo.save.mockImplementation((q) => Promise.resolve(q));

      const result = await service.answerQuestion(ssWorkerUser, 'q-1', {
        answerText: 'Because...',
      });

      expect(result.answerText).toBe('Because...');
      expect(result.answeredBy).toEqual({ id: ssWorkerUser.id });
      expect(result.answeredAt).toBeInstanceOf(Date);
      expect(mockNotificationDispatchService.notifyMember).toHaveBeenCalledWith(
        expect.objectContaining({
          email: expect.objectContaining({ to: 'jane@example.com' }),
          push: expect.objectContaining({ memberIds: ['member-1'] }),
        }),
      );
    });
  });

  // ─── admin: questions ─────────────────────────────────────────────────────

  describe('adminGetQuestionsForClass', () => {
    it('should throw NotFoundException when class not found', async () => {
      mockClassRepo.findOne.mockResolvedValue(null);

      await expect(service.adminGetQuestionsForClass('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns paginated questions', async () => {
      mockClassRepo.findOne.mockResolvedValue(mockClass);
      mockQuestionRepo.findAndCount.mockResolvedValue([[{ id: 'q-1' }], 1]);

      const result = await service.adminGetQuestionsForClass('class-1');

      expect(result.data).toHaveLength(1);
    });
  });

  describe('adminAnswerQuestion', () => {
    it('should throw NotFoundException when question not found', async () => {
      mockQuestionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.adminAnswerQuestion('bad-id', { answerText: 'x' }, 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('answers the question without requiring worker auth', async () => {
      const question = {
        id: 'q-1',
        questionText: 'Why?',
        sundaySchoolClass: { id: 'class-1', name: 'Beginners' },
        askedBy: { id: 'member-1', firstname: 'Jane', email: 'jane@x.com' },
      };
      mockQuestionRepo.findOne.mockResolvedValue(question);
      mockQuestionRepo.save.mockImplementation((q) => Promise.resolve(q));

      const result = await service.adminAnswerQuestion(
        'q-1',
        { answerText: 'Because...' },
        'admin-1',
      );

      expect(result.answerText).toBe('Because...');
      expect(result.answeredBy).toEqual({ id: 'admin-1' });
    });
  });

  describe('adminDeleteQuestion', () => {
    it('should throw NotFoundException when question not found', async () => {
      mockQuestionRepo.findOne.mockResolvedValue(null);

      await expect(service.adminDeleteQuestion('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('removes the question', async () => {
      const question = { id: 'q-1' };
      mockQuestionRepo.findOne.mockResolvedValue(question);
      mockQuestionRepo.remove.mockResolvedValue(undefined);

      await service.adminDeleteQuestion('q-1');

      expect(mockQuestionRepo.remove).toHaveBeenCalledWith(question);
    });
  });

  describe('adminBulkAssignMembers', () => {
    beforeEach(() => {
      mockMemberEmailQb.select.mockReturnThis();
      mockMemberEmailQb.where.mockReturnThis();
      mockMemberEmailQb.getMany.mockResolvedValue([]);
      mockMemberRepo.createQueryBuilder.mockReturnValue(mockMemberEmailQb);
      mockMemberRepo.find.mockResolvedValue([]);
      mockClassRepo.findOne.mockResolvedValue({ id: 'class-1' });
      mockMemberAssignRepo.create.mockImplementation((v) => v);
      mockMemberAssignRepo.save.mockImplementation((v) => Promise.resolve(v));
    });

    it('adds new members by id and email, skipping those already in the class', async () => {
      mockMemberRepo.find.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);
      mockMemberEmailQb.getMany.mockResolvedValue([
        { id: 'm3', email: 'Ada@x.org' },
      ]);
      mockMemberAssignRepo.find.mockResolvedValue([{ member: { id: 'm2' } }]);

      const result = await service.adminBulkAssignMembers(
        'class-1',
        ['m1', 'm2', 'm-missing'],
        ['ada@x.org', ' NOBODY@x.org'],
      );

      expect(mockMemberEmailQb.where).toHaveBeenCalledWith(
        'LOWER(m.email) IN (:...emails)',
        { emails: ['ada@x.org', 'nobody@x.org'] },
      );
      const saved = mockMemberAssignRepo.save.mock.calls[0][0];
      expect(saved.map((a: any) => a.member.id)).toEqual(['m1', 'm3']);
      expect(result).toEqual({
        added: 2,
        alreadyInClass: 1,
        notFound: ['m-missing', 'nobody@x.org'],
        inAnotherClass: [],
      });
    });

    it('saves nothing when everyone is already in the class', async () => {
      mockMemberRepo.find.mockResolvedValue([{ id: 'm1' }]);
      mockMemberAssignRepo.find.mockResolvedValue([{ member: { id: 'm1' } }]);

      await expect(
        service.adminBulkAssignMembers('class-1', ['m1']),
      ).resolves.toEqual({
        added: 0,
        alreadyInClass: 1,
        notFound: [],
        inAnotherClass: [],
      });
      expect(mockMemberAssignRepo.save).not.toHaveBeenCalled();
    });

    it('rejects an empty request and an unknown class', async () => {
      await expect(
        service.adminBulkAssignMembers('class-1', [], []),
      ).rejects.toThrow(BadRequestException);
      mockClassRepo.findOne.mockResolvedValue(null);
      await expect(
        service.adminBulkAssignMembers('nope', ['m1']),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('one class per member', () => {
    beforeEach(() => {
      mockSettings.isOneClassPerMember.mockResolvedValue(true);
      mockClassRepo.findOne.mockResolvedValue({
        id: 'class-1',
        name: 'Seniors',
      });
      mockMemberRepo.existsBy.mockResolvedValue(true);
      mockMemberAssignRepo.findOne.mockResolvedValue(null);
      mockMemberAssignRepo.create.mockImplementation((v) => v);
      mockMemberAssignRepo.save.mockImplementation((v) => Promise.resolve(v));
    });

    it('refuses to add a member who is already in another class', async () => {
      mockMemberAssignRepo.find.mockResolvedValue([
        {
          member: { id: 'm1' },
          sundaySchoolClass: { id: 'class-2', name: 'Juniors' },
        },
      ]);
      await expect(service.adminAssignMember('class-1', 'm1')).rejects.toThrow(
        'This member is already in Juniors.',
      );
      expect(mockMemberAssignRepo.save).not.toHaveBeenCalled();
    });

    it('allows several classes when the setting is off', async () => {
      mockSettings.isOneClassPerMember.mockResolvedValue(false);
      await service.adminAssignMember('class-1', 'm1');
      expect(mockMemberAssignRepo.save).toHaveBeenCalled();
      expect(mockMemberAssignRepo.find).not.toHaveBeenCalled();
    });

    it('skips and reports members in another class during a bulk add', async () => {
      mockMemberEmailQb.select.mockReturnThis();
      mockMemberEmailQb.where.mockReturnThis();
      mockMemberRepo.createQueryBuilder.mockReturnValue(mockMemberEmailQb);
      mockMemberRepo.find.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);
      mockMemberAssignRepo.find
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            member: { id: 'm2' },
            sundaySchoolClass: { id: 'class-2', name: 'Juniors' },
          },
        ]);

      const result = await service.adminBulkAssignMembers('class-1', [
        'm1',
        'm2',
      ]);

      expect(result).toMatchObject({
        added: 1,
        inAnotherClass: [{ memberId: 'm2', className: 'Juniors' }],
      });
      const saved = mockMemberAssignRepo.save.mock.calls[0][0];
      expect(saved.map((a: any) => a.member.id)).toEqual(['m1']);
    });
  });

  describe('teacher bulk add and candidates', () => {
    it('lets the class teacher bulk add and list candidates for their class', async () => {
      mockDepartmentAccessService.hasCapability.mockResolvedValue(false);
      mockClassRepo.findOne.mockResolvedValue(mockClass);
      const bulk = jest
        .spyOn(service, 'adminBulkAssignMembers')
        .mockResolvedValue({
          added: 1,
          alreadyInClass: 0,
          notFound: [],
          inAnotherClass: [],
        });
      const candidates = jest
        .spyOn(service, 'adminClassCandidates')
        .mockResolvedValue({ data: [] } as never);

      await service.bulkAssignMembers(otherWorkerUser, 'class-1', ['m1'], []);
      await service.classCandidates(otherWorkerUser, 'class-1', 'ada', 2, 25);

      expect(bulk).toHaveBeenCalledWith('class-1', ['m1'], []);
      expect(candidates).toHaveBeenCalledWith('class-1', 'ada', 2, 25);
    });

    it('refuses teachers when the church has adding members set to admins only', async () => {
      mockDepartmentAccessService.hasCapability.mockResolvedValue(true);
      mockSettings.assertTeachersCanAddMembers.mockRejectedValue(
        new ForbiddenException('admins only'),
      );
      const bulk = jest.spyOn(service, 'adminBulkAssignMembers');

      await expect(
        service.bulkAssignMembers(ssWorkerUser, 'class-1', ['m1']),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.classCandidates(ssWorkerUser, 'class-1'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.assignMember(ssWorkerUser, 'class-1', { memberId: 'm1' }),
      ).rejects.toThrow(ForbiddenException);
      expect(bulk).not.toHaveBeenCalled();
      expect(mockMemberAssignRepo.save).not.toHaveBeenCalled();
    });

    it("refuses a worker who is neither Sunday School staff nor the class's teacher", async () => {
      mockDepartmentAccessService.hasCapability.mockResolvedValue(false);
      mockClassRepo.findOne.mockResolvedValue(null);
      const bulk = jest.spyOn(service, 'adminBulkAssignMembers');

      await expect(
        service.bulkAssignMembers(otherWorkerUser, 'class-2', ['m1']),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.classCandidates(otherWorkerUser, 'class-2'),
      ).rejects.toThrow(ForbiddenException);
      expect(bulk).not.toHaveBeenCalled();
    });
  });

  describe('adminClassCandidates', () => {
    const qb = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(),
    };

    beforeEach(() => {
      Object.values(qb).forEach((fn) => fn.mockReturnThis());
      mockMemberRepo.createQueryBuilder.mockReturnValue(qb as never);
      mockClassRepo.findOne.mockResolvedValue({ id: 'class-1' });
      qb.getManyAndCount.mockResolvedValue([
        [
          { id: 'm1', firstname: 'Ada', lastname: 'Obi', email: 'ada@x.org' },
          {
            id: 'm2',
            firstname: 'Tunde',
            lastname: 'Bello',
            email: 'tunde@x.org',
          },
        ],
        2,
      ]);
      mockMemberAssignRepo.find.mockResolvedValue([
        {
          member: { id: 'm2' },
          sundaySchoolClass: { id: 'class-2', name: 'Juniors' },
        },
      ]);
    });

    it('leaves out members already in the class and searches by name or email', async () => {
      await service.adminClassCandidates('class-1', ' Ada ');
      expect(qb.where.mock.calls[0][0]).toContain('NOT EXISTS');
      expect(qb.where.mock.calls[0][1]).toEqual({ classId: 'class-1' });
      expect(qb.andWhere).toHaveBeenCalledWith(
        '(m.firstname ILIKE :w0 OR m.lastname ILIKE :w0 OR m.email ILIKE :w0)',
        { w0: '%Ada%' },
      );
    });

    it('matches "first last" word by word and escapes LIKE wildcards', async () => {
      await service.adminClassCandidates('class-1', 'ada  o_bi%');
      expect(qb.andWhere).toHaveBeenCalledWith(expect.any(String), {
        w0: '%ada%',
      });
      expect(qb.andWhere).toHaveBeenCalledWith(expect.any(String), {
        w1: '%o\\_bi\\%%',
      });
    });

    it('marks members in other classes, blocking them only when the church allows one class', async () => {
      let result = await service.adminClassCandidates('class-1');
      expect(result.data[1]).toMatchObject({
        otherClasses: ['Juniors'],
        blocked: false,
      });

      mockSettings.isOneClassPerMember.mockResolvedValue(true);
      result = await service.adminClassCandidates('class-1');
      expect(result.data[0]).toMatchObject({
        otherClasses: [],
        blocked: false,
      });
      expect(result.data[1]).toMatchObject({ blocked: true });
      expect(result.oneClassPerMember).toBe(true);
    });
  });

  // ─── Class details & assistants ──────────────────────────────────────────

  describe('class details and assistants', () => {
    it('saves age group, meeting day/time, room and assistants (dropping the teacher from assistants)', async () => {
      mockClassRepo.create.mockImplementation((v) => v);
      mockClassRepo.save.mockImplementation((v) =>
        Promise.resolve({ id: 'class-9', ...v }),
      );
      mockMemberRepo.existsBy.mockResolvedValue(true);
      mockMemberRepo.find.mockResolvedValue([{ id: 'a1' }]);

      await service.adminCreateClass({
        name: 'Teens',
        teacherId: 't1',
        ageGroup: '13–17',
        meetingDay: 'SUNDAY' as never,
        meetingTime: '09:00',
        location: 'Room 2',
        assistantIds: ['a1', 't1', 'a1'],
      });

      expect(mockMemberRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: expect.anything() } }),
      );
      expect(mockClassRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          ageGroup: '13–17',
          meetingDay: 'SUNDAY',
          meetingTime: '09:00',
          location: 'Room 2',
          assistants: [{ id: 'a1' }],
        }),
      );
    });

    it('refuses an assistant who is not a member', async () => {
      mockClassRepo.create.mockImplementation((v) => v);
      mockMemberRepo.find.mockResolvedValue([]);

      await expect(
        service.adminCreateClass({ name: 'Teens', assistantIds: ['ghost'] }),
      ).rejects.toThrow(NotFoundException);
      expect(mockClassRepo.save).not.toHaveBeenCalled();
    });

    it('clears details with null and leaves untouched ones alone', async () => {
      const entity = {
        id: 'class-1',
        name: 'Teens',
        teacher: null,
        ageGroup: '13–17',
        meetingDay: 'SUNDAY',
        meetingTime: '09:00',
        location: 'Room 2',
      };
      mockClassRepo.findOne.mockResolvedValue(entity);
      mockClassRepo.save.mockImplementation((v) => Promise.resolve(v));

      await service.adminUpdateClass('class-1', {
        location: null,
        meetingTime: null,
      });

      expect(mockClassRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          ageGroup: '13–17',
          meetingDay: 'SUNDAY',
          meetingTime: null,
          location: null,
        }),
      );
    });

    it('treats an assistant like the class teacher for authorization', async () => {
      mockDepartmentAccessService.hasCapability.mockResolvedValue(false);
      mockClassRepo.findOne.mockResolvedValue(mockClass);

      await expect(
        service.assertCanManageClass(otherWorkerUser, 'class-1'),
      ).resolves.toBeUndefined();
      expect(mockClassRepo.findOne).toHaveBeenCalledWith({
        where: [
          { id: 'class-1', teacher: { id: otherWorkerUser.id } },
          { id: 'class-1', assistants: { id: otherWorkerUser.id } },
        ],
      });
    });

    it('lists the classes a worker teaches or assists, with member counts', async () => {
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockClass]),
      };
      (mockClassRepo as any).createQueryBuilder = jest.fn(() => qb);
      mockMembersCountQueryBuilder.getRawMany.mockResolvedValue([
        { classId: 'class-1', count: '4' },
      ]);

      const result = await service.getMyTeachingClasses(otherWorkerUser);

      expect(qb.where).toHaveBeenCalledWith(expect.any(String), {
        me: otherWorkerUser.id,
      });
      expect(result).toEqual([
        expect.objectContaining({ id: 'class-1', membersCount: 4 }),
      ]);
    });
  });

  // ─── Session editing & series ────────────────────────────────────────────

  describe('seriesDates', () => {
    it('steps by whole weeks in UTC, inclusive of both ends', () => {
      expect(seriesDates('2026-10-04', '2026-10-25', 1)).toEqual([
        '2026-10-04',
        '2026-10-11',
        '2026-10-18',
        '2026-10-25',
      ]);
      expect(seriesDates('2026-10-04', '2026-11-01', 2)).toEqual([
        '2026-10-04',
        '2026-10-18',
        '2026-11-01',
      ]);
      expect(seriesDates('2026-10-04', '2026-10-01', 1)).toEqual([]);
    });

    it('crosses a daylight-saving change without drifting a day', () => {
      expect(seriesDates('2026-03-22', '2026-04-05', 1)).toEqual([
        '2026-03-22',
        '2026-03-29',
        '2026-04-05',
      ]);
    });
  });

  describe('adminCreateSessionSeries', () => {
    const insertQb = {
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({}),
    };

    beforeEach(() => {
      Object.values(insertQb).forEach((fn) => fn.mockReturnThis());
      insertQb.execute.mockResolvedValue({});
      (mockSessionRepo as any).createQueryBuilder = jest.fn(() => insertQb);
      mockClassRepo.findOne.mockResolvedValue(mockClass);
    });

    it('creates every week in range, skipping dates that already have a session', async () => {
      mockSessionRepo.find.mockResolvedValue([
        { id: 's1', sessionDate: '2026-10-11' },
      ]);

      const result = await service.adminCreateSessionSeries({
        classId: 'class-1',
        startDate: '2026-10-04',
        endDate: '2026-10-25',
        notes: 'Term 4',
      });

      expect(result).toEqual({
        created: 3,
        skipped: ['2026-10-11'],
        dates: ['2026-10-04', '2026-10-18', '2026-10-25'],
      });
      expect(insertQb.values).toHaveBeenCalledWith([
        expect.objectContaining({ sessionDate: '2026-10-04', notes: 'Term 4' }),
        expect.objectContaining({ sessionDate: '2026-10-18' }),
        expect.objectContaining({ sessionDate: '2026-10-25' }),
      ]);
      expect(insertQb.orIgnore).toHaveBeenCalled();
    });

    it('refuses an end date before the start, or more than 60 sessions', async () => {
      await expect(
        service.adminCreateSessionSeries({
          classId: 'class-1',
          startDate: '2026-10-04',
          endDate: '2026-10-01',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.adminCreateSessionSeries({
          classId: 'class-1',
          startDate: '2026-01-04',
          endDate: '2028-01-04',
        }),
      ).rejects.toThrow(/at most 60/);
      expect(insertQb.execute).not.toHaveBeenCalled();
    });

    it('teachers need rights to the class', async () => {
      mockDepartmentAccessService.hasCapability.mockResolvedValue(false);
      mockClassRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createSessionSeries(otherWorkerUser, {
          classId: 'class-2',
          startDate: '2026-10-04',
          endDate: '2026-10-25',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('adminUpdateSession', () => {
    it('moves the date and edits notes/link, keeping the session (and its attendance)', async () => {
      const session = {
        id: 'session-1',
        sessionDate: '2026-10-04',
        notes: 'old',
        documentUrl: 'https://old.example',
        selfMarkClosesAt: null,
        sundaySchoolClass: mockClass,
      };
      mockSessionRepo.findOne
        .mockResolvedValueOnce(session)
        .mockResolvedValueOnce(null);
      mockSessionRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await service.adminUpdateSession('session-1', {
        sessionDate: '2026-10-05',
        notes: '',
        documentUrl: 'https://new.example',
      });

      expect(result).toEqual(
        expect.objectContaining({
          id: 'session-1',
          sessionDate: '2026-10-05',
          notes: null,
          documentUrl: 'https://new.example',
        }),
      );
      expect(mockSessionRepo.save).toHaveBeenCalledTimes(1);
    });

    it('refuses to move onto a date the class already has a session on', async () => {
      mockSessionRepo.findOne
        .mockResolvedValueOnce({
          id: 'session-1',
          sessionDate: '2026-10-04',
          sundaySchoolClass: mockClass,
        })
        .mockResolvedValueOnce({ id: 'session-2' });

      await expect(
        service.adminUpdateSession('session-1', { sessionDate: '2026-10-11' }),
      ).rejects.toThrow(ConflictException);
      expect(mockSessionRepo.save).not.toHaveBeenCalled();
    });

    it('404s for an unknown session', async () => {
      mockSessionRepo.findOne.mockResolvedValue(null);
      await expect(
        service.adminUpdateSession('nope', { notes: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Teacher marking window ──────────────────────────────────────────────

  describe('teacher marking window', () => {
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      jest.setSystemTime(new Date('2026-10-14T12:00:00Z'));
      mockDepartmentAccessService.hasCapability.mockResolvedValue(true);
      mockSettings.teacherMarkingDays.mockResolvedValue(2);
    });
    afterEach(() => jest.useRealTimers());

    const sessionOn = (sessionDate: string) => ({
      id: 'session-1',
      sessionDate,
      selfMarkClosesAt: null,
      sundaySchoolClass: mockClass,
    });

    it('lets teachers mark up to N days after the session', async () => {
      mockSessionRepo.findOne.mockResolvedValue(sessionOn('2026-10-12'));
      mockAttendanceRepo.manager = {
        transaction: jest.fn().mockResolvedValue([]),
      } as never;

      await expect(
        service.bulkMarkAttendance(ssWorkerUser, 'session-1', {
          attendances: [{ memberId: 'm1', status: 'PRESENT' as never }],
        }),
      ).resolves.toEqual([]);
    });

    it('closes marking, check-in and first-timer check-in for teachers after that', async () => {
      mockSessionRepo.findOne.mockResolvedValue(sessionOn('2026-10-11'));

      await expect(
        service.bulkMarkAttendance(ssWorkerUser, 'session-1', {
          attendances: [{ memberId: 'm1', status: 'PRESENT' as never }],
        }),
      ).rejects.toThrow(/closed on 2026-10-13/);
      await expect(
        service.openSelfMark(ssWorkerUser, 'session-1', 30),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.checkInFirstTimer(ssWorkerUser, 'session-1', {
          firstname: 'G',
          lastname: 'V',
          phone: '08000000000',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockSessionRepo.save).not.toHaveBeenCalled();
      expect(
        mockFollowUpService.createFirstTimerFromSundaySchoolCheckIn,
      ).not.toHaveBeenCalled();
    });

    it('tells the roster whether teachers can still mark', async () => {
      mockSessionRepo.findOne.mockResolvedValue(sessionOn('2026-10-11'));
      mockMemberAssignRepo.find.mockResolvedValue([]);
      mockAttendanceRepo.find.mockResolvedValue([]);

      const roster = await service.getSessionRoster(ssWorkerUser, 'session-1');

      expect(roster).toEqual(
        expect.objectContaining({
          teacherMarkingOpen: false,
          teacherMarkingClosesOn: '2026-10-13',
        }),
      );
    });

    it('does not limit admins', async () => {
      mockSessionRepo.findOne.mockResolvedValue(sessionOn('2026-01-04'));
      mockSessionRepo.save.mockImplementation((v) => Promise.resolve(v));
      mockMemberAssignRepo.find.mockResolvedValue([]);
      mockAttendanceRepo.find.mockResolvedValue([]);

      await expect(service.adminOpenSession('session-1', 30)).resolves.toEqual(
        expect.objectContaining({ selfMarkOpen: true }),
      );
      expect(mockSettings.teacherMarkingDays).not.toHaveBeenCalled();
    });
  });
});
