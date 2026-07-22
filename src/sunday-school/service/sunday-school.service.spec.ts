import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SundaySchoolService } from './sunday-school.service';
import { SundaySchoolClass } from '../entity/sunday-school-class.entity';
import { SundaySchoolMember } from '../entity/sunday-school-member.entity';
import { SundaySchoolSession } from '../entity/sunday-school-session.entity';
import { SundaySchoolAttendance } from '../entity/sunday-school-attendance.entity';
import { SundaySchoolAttendanceStatus } from '../enums/sunday-school-attendance-status.enum';
import { Member } from '../../member/entity/member.entity';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { DepartmentKeyEnum } from '../../department/enums/department-key.enum';
import { DepartmentAccessService } from '../../department/service/department-access.service';
import { CacheService } from '../../utility/service/cache.service';
import { SessionSurface } from '../../auth/enum/session-surface.enum';

const mockClassRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  remove: jest.fn(),
};

const mockMemberAssignRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  find: jest.fn(),
  remove: jest.fn(),
  count: jest.fn().mockResolvedValue(0),
};

const mockSessionRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
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

const mockMemberRepo = {
  existsBy: jest.fn(),
};

const mockDepartmentAccessService = {
  hasDepartmentAccessKey: jest.fn(),
  assertHasDepartmentAccessKey: jest.fn(),
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
          provide: DepartmentAccessService,
          useValue: mockDepartmentAccessService,
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
      ],
    }).compile();

    service = module.get<SundaySchoolService>(SundaySchoolService);
  });

  // ─── Authorization ───────────────────────────────────────────────────────

  describe('requireSundaySchoolAuth (via createClass)', () => {
    it('admin worker in SS dept is authorized', async () => {
      mockDepartmentAccessService.hasDepartmentAccessKey.mockResolvedValue(
        true,
      );
      mockClassRepo.create.mockReturnValue(mockClass);
      mockClassRepo.save.mockResolvedValue(mockClass);

      await expect(
        service.createClass(adminUser, { name: 'Alpha' }),
      ).resolves.not.toThrow();
    });

    it('Sunday School dept worker is authorized', async () => {
      mockDepartmentAccessService.hasDepartmentAccessKey.mockResolvedValue(
        true,
      );
      mockClassRepo.create.mockReturnValue(mockClass);
      mockClassRepo.save.mockResolvedValue(mockClass);

      await expect(
        service.createClass(ssWorkerUser, { name: 'Alpha' }),
      ).resolves.not.toThrow();
    });

    it('Worker whose secondary department is Sunday School is authorized', async () => {
      mockDepartmentAccessService.hasDepartmentAccessKey.mockResolvedValue(
        true,
      );
      mockClassRepo.create.mockReturnValue(mockClass);
      mockClassRepo.save.mockResolvedValue(mockClass);

      await expect(
        service.createClass(ssWorkerUser, { name: 'Alpha' }),
      ).resolves.not.toThrow();
    });

    it('Worker from another dept without class teacher role is rejected', async () => {
      mockDepartmentAccessService.hasDepartmentAccessKey.mockResolvedValue(
        false,
      );

      await expect(
        service.createClass(otherWorkerUser, { name: 'Alpha' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('checks the SUNDAY_SCHOOL key via DepartmentAccessService', async () => {
      mockDepartmentAccessService.hasDepartmentAccessKey.mockResolvedValue(
        true,
      );
      mockClassRepo.create.mockReturnValue(mockClass);
      mockClassRepo.save.mockResolvedValue(mockClass);

      await service.createClass(ssWorkerUser, { name: 'Alpha' });

      expect(
        mockDepartmentAccessService.hasDepartmentAccessKey,
      ).toHaveBeenCalledWith(ssWorkerUser.id, DepartmentKeyEnum.SUNDAY_SCHOOL);
    });
  });

  describe('requireSundaySchoolAuth (via assignMember — class teacher fallback)', () => {
    it('Class teacher from another dept is authorized for their own class', async () => {
      // otherWorkerUser is NOT in SS dept, but IS the teacher of class-1
      mockDepartmentAccessService.hasDepartmentAccessKey.mockResolvedValue(
        false,
      );
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
      mockDepartmentAccessService.hasDepartmentAccessKey.mockResolvedValue(
        false,
      );
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
      mockDepartmentAccessService.hasDepartmentAccessKey.mockResolvedValue(
        true,
      );
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
      mockClassRepo.create.mockReturnValue({ ...dto });
      mockClassRepo.save.mockResolvedValue({ id: 'class-2', ...dto });

      await service.createClass(ssWorkerUser, dto as any);

      expect(mockClassRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ teacher: { id: 'member-99' } }),
      );
    });
  });

  // ─── updateClass ─────────────────────────────────────────────────────────

  describe('updateClass', () => {
    beforeEach(() => {
      mockDepartmentAccessService.hasDepartmentAccessKey.mockResolvedValue(
        true,
      );
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

      const result = await service.updateClass(adminUser, 'class-1', {
        name: 'New',
        teacherId: 'member-5',
      });

      expect(result.name).toBe('New');
      expect(result.teacher).toEqual({ id: 'member-5' });
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
  });

  // ─── assignMember ─────────────────────────────────────────────────────────

  describe('assignMember', () => {
    beforeEach(() => {
      mockDepartmentAccessService.hasDepartmentAccessKey.mockResolvedValue(
        true,
      );
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
      mockDepartmentAccessService.hasDepartmentAccessKey.mockResolvedValue(
        true,
      );
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
      mockDepartmentAccessService.hasDepartmentAccessKey.mockResolvedValue(
        true,
      );
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
    });

    it('should throw ForbiddenException for unauthorized worker', async () => {
      mockDepartmentAccessService.hasDepartmentAccessKey.mockResolvedValue(
        false,
      );
      mockClassRepo.findOne.mockResolvedValue(null); // not the teacher either

      await expect(
        service.createSession(otherWorkerUser, {
          classId: 'class-1',
          sessionDate: '2026-06-08',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── openSelfMark / closeSelfMark ─────────────────────────────────────────

  describe('openSelfMark', () => {
    beforeEach(() => {
      mockDepartmentAccessService.hasDepartmentAccessKey.mockResolvedValue(
        true,
      );
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
    });
  });

  describe('closeSelfMark', () => {
    beforeEach(() => {
      mockDepartmentAccessService.hasDepartmentAccessKey.mockResolvedValue(
        true,
      );
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

    it('should update existing ABSENT record to PRESENT', async () => {
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
      mockMemberAssignRepo.findOne.mockResolvedValue({ id: 'assign-1' });
      const existingAtt = {
        id: 'att-1',
        status: SundaySchoolAttendanceStatus.ABSENT,
        markedByTeacher: true,
      };
      mockAttendanceRepo.findOne.mockResolvedValue(existingAtt);
      mockAttendanceRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.selfMarkPresent(memberUser, 'session-1');

      expect(result.status).toBe(SundaySchoolAttendanceStatus.PRESENT);
      expect(result.markedByTeacher).toBe(false);
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

  // ─── bulkMarkAttendance ───────────────────────────────────────────────────

  describe('bulkMarkAttendance', () => {
    beforeEach(() => {
      mockDepartmentAccessService.hasDepartmentAccessKey.mockResolvedValue(
        true,
      );
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

    it('should update existing attendance records', async () => {
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
      const existing = {
        id: 'att-1',
        status: SundaySchoolAttendanceStatus.ABSENT,
        markedByTeacher: false,
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
    });

    it('should throw ForbiddenException for unauthorized worker', async () => {
      mockSessionRepo.findOne.mockResolvedValue(mockSession);
      mockDepartmentAccessService.hasDepartmentAccessKey.mockResolvedValue(
        false,
      );
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
      mockDepartmentAccessService.hasDepartmentAccessKey.mockResolvedValue(
        true,
      );
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
  });
});
