import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClassesService } from './classes.service';
import { ChurchClass } from '../entity/church-class.entity';
import { ClassEnrollment } from '../entity/class-enrollment.entity';
import { ClassMaterial } from '../entity/class-material.entity';
import { ClassFacilitator } from '../entity/class-facilitator.entity';
import { Member } from '../../member/entity/member.entity';
import { EnrollmentStatusEnum } from '../enum/enrollment-status.enum';
import { ChurchClassStatusEnum } from '../enum/church-class-status.enum';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { UtilityService } from '../../utility/service/utility.service';
import { CloudinaryService } from '../../utility/service/cloudinary.service';
import { GuestService } from './guest.service';

const makeQb = () => ({
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  leftJoin: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn(),
  getMany: jest.fn(),
  getRawMany: jest.fn(),
});

const mockClassRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  findAndCount: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  remove: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockEnrollmentRepo = {
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  count: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockMemberRepo = {
  findOne: jest.fn(),
  existsBy: jest.fn(),
  find: jest.fn(),
};

const mockMaterialRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  count: jest.fn(),
  exists: jest.fn(),
};

const mockFacilitatorRepo = {
  create: jest.fn((v) => v),
  save: jest.fn(),
  delete: jest.fn(),
};

const mockAuditLogService = { log: jest.fn() };

const mockUtilityService = {
  sendEmailWithTemplate: jest.fn(),
  resolveMemberUrl: jest
    .fn()
    .mockResolvedValue('https://tenant.app/classes/guest/enroll-1'),
};

const mockConfigService = {
  get: jest.fn(),
};

const mockCloudinaryService = {
  uploadBuffer: jest.fn(),
  deleteByPublicId: jest.fn(),
};

const mockGuestService = {
  findOrCreateByEmail: jest.fn(),
  getById: jest.fn(),
};

describe('ClassesService', () => {
  let service: ClassesService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassesService,
        { provide: getRepositoryToken(ChurchClass), useValue: mockClassRepo },
        {
          provide: getRepositoryToken(ClassEnrollment),
          useValue: mockEnrollmentRepo,
        },
        { provide: getRepositoryToken(Member), useValue: mockMemberRepo },
        {
          provide: getRepositoryToken(ClassMaterial),
          useValue: mockMaterialRepo,
        },
        {
          provide: getRepositoryToken(ClassFacilitator),
          useValue: mockFacilitatorRepo,
        },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: UtilityService, useValue: mockUtilityService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: CloudinaryService, useValue: mockCloudinaryService },
        { provide: GuestService, useValue: mockGuestService },
      ],
    }).compile();

    service = module.get<ClassesService>(ClassesService);
  });

  describe('createClass', () => {
    it('should create and save church class', async () => {
      const dto = {
        name: 'New Believers',
        classTypeId: 'class-type-1',
        description: 'Intro class',
      };
      const classObj = { id: 'class-1', ...dto };
      mockClassRepo.create.mockReturnValue(classObj);
      mockClassRepo.save.mockResolvedValue(classObj);

      const result = await service.createClass(dto as any);

      expect(mockClassRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: dto.name,
          classType: { id: dto.classTypeId },
        }),
      );
      expect(mockClassRepo.save).toHaveBeenCalledWith(classObj);
      expect(result).toMatchObject({ id: 'class-1' });
    });

    it('creates no facilitator rows when none are provided', async () => {
      const dto = { name: 'Class', classTypeId: 'class-type-1' };
      mockClassRepo.create.mockReturnValue({ ...dto });
      mockClassRepo.save.mockResolvedValue({ id: 'class-1', ...dto });

      await service.createClass(dto as any);

      expect(mockFacilitatorRepo.save).not.toHaveBeenCalled();
    });

    it('creates a facilitator row for a member and one for a guest name, in order', async () => {
      const dto = {
        name: 'Class',
        classTypeId: 'class-type-1',
        facilitators: [{ memberId: 'member-1' }, { guestName: 'Jane Doe' }],
      };
      const saved = { id: 'class-1', ...dto };
      mockClassRepo.create.mockReturnValue({ ...dto });
      mockClassRepo.save.mockResolvedValue(saved);

      await service.createClass(dto as any);

      expect(mockFacilitatorRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({
          churchClass: saved,
          member: { id: 'member-1' },
          guestName: null,
          order: 0,
        }),
        expect.objectContaining({
          churchClass: saved,
          member: null,
          guestName: 'Jane Doe',
          order: 1,
        }),
      ]);
    });

    it('throws BadRequestException when a facilitator entry has both memberId and guestName', async () => {
      const dto = {
        name: 'Class',
        classTypeId: 'class-type-1',
        facilitators: [{ memberId: 'member-1', guestName: 'Jane Doe' }],
      };
      mockClassRepo.create.mockReturnValue({ ...dto });
      mockClassRepo.save.mockResolvedValue({ id: 'class-1', ...dto });

      await expect(service.createClass(dto as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when a facilitator entry has neither memberId nor guestName', async () => {
      const dto = {
        name: 'Class',
        classTypeId: 'class-type-1',
        facilitators: [{}],
      };
      mockClassRepo.create.mockReturnValue({ ...dto });
      mockClassRepo.save.mockResolvedValue({ id: 'class-1', ...dto });

      await expect(service.createClass(dto as any)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('updateClass', () => {
    it('leaves facilitators untouched when the field is omitted from the update', async () => {
      mockClassRepo.findOne.mockResolvedValue({ id: 'class-1', name: 'X' });
      mockClassRepo.save.mockImplementation((c) => Promise.resolve(c));

      await service.updateClass('class-1', { name: 'Y' } as any);

      expect(mockFacilitatorRepo.delete).not.toHaveBeenCalled();
    });

    it('replaces the full facilitator list when facilitators is provided', async () => {
      const churchClass = { id: 'class-1', name: 'X' };
      mockClassRepo.findOne.mockResolvedValue(churchClass);
      mockClassRepo.save.mockImplementation((c) => Promise.resolve(c));

      await service.updateClass('class-1', {
        facilitators: [{ guestName: 'New Facilitator' }],
      } as any);

      expect(mockFacilitatorRepo.delete).toHaveBeenCalledWith({
        churchClass: { id: 'class-1' },
      });
      expect(mockFacilitatorRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ guestName: 'New Facilitator', order: 0 }),
      ]);
    });
  });

  describe('enrollMember', () => {
    const churchClass = { id: 'class-1', name: 'New Believers' };

    it('should throw NotFoundException if class does not exist', async () => {
      mockClassRepo.findOne.mockResolvedValue(null);

      await expect(
        service.enrollMember({
          memberId: 'member-1',
          classId: 'class-1',
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if member does not exist', async () => {
      mockClassRepo.findOne.mockResolvedValue(churchClass);
      mockMemberRepo.existsBy.mockResolvedValue(false);

      await expect(
        service.enrollMember({
          memberId: 'nonexistent',
          classId: 'class-1',
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if member is IN_PROGRESS in this class', async () => {
      mockClassRepo.findOne.mockResolvedValue(churchClass);
      mockMemberRepo.existsBy.mockResolvedValue(true);
      mockEnrollmentRepo.findOne.mockResolvedValue({
        id: 'enroll-1',
        status: EnrollmentStatusEnum.IN_PROGRESS,
      });

      await expect(
        service.enrollMember({
          memberId: 'member-1',
          classId: 'class-1',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if member has COMPLETED this class', async () => {
      mockClassRepo.findOne.mockResolvedValue(churchClass);
      mockMemberRepo.existsBy.mockResolvedValue(true);
      mockEnrollmentRepo.findOne.mockResolvedValue({
        id: 'enroll-1',
        status: EnrollmentStatusEnum.COMPLETED,
      });

      await expect(
        service.enrollMember({
          memberId: 'member-1',
          classId: 'class-1',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reset a CANCELLED enrollment back to IN_PROGRESS (re-enroll)', async () => {
      mockClassRepo.findOne.mockResolvedValue(churchClass);
      mockMemberRepo.existsBy.mockResolvedValue(true);
      const cancelled = {
        id: 'enroll-1',
        status: EnrollmentStatusEnum.CANCELLED,
        cancelledAt: new Date(),
        completedAt: null,
      };
      mockEnrollmentRepo.findOne.mockResolvedValue(cancelled);
      mockEnrollmentRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.enrollMember({
        memberId: 'member-1',
        classId: 'class-1',
      } as any);

      expect(result.status).toBe(EnrollmentStatusEnum.IN_PROGRESS);
      expect(result.cancelledAt).toBeNull();
      expect(mockEnrollmentRepo.create).not.toHaveBeenCalled();
      expect(mockEnrollmentRepo.save).toHaveBeenCalled();
    });

    it('should create a fresh enrollment when no prior record exists', async () => {
      mockClassRepo.findOne.mockResolvedValue(churchClass);
      mockMemberRepo.existsBy.mockResolvedValue(true);
      mockEnrollmentRepo.findOne.mockResolvedValue(null);
      const enrollment = {
        id: 'enroll-1',
        status: EnrollmentStatusEnum.IN_PROGRESS,
      };
      mockEnrollmentRepo.create.mockReturnValue(enrollment);
      mockEnrollmentRepo.save.mockResolvedValue(enrollment);

      const result = await service.enrollMember({
        memberId: 'member-1',
        classId: 'class-1',
      } as any);

      expect(mockEnrollmentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: EnrollmentStatusEnum.IN_PROGRESS }),
      );
      expect(result.status).toBe(EnrollmentStatusEnum.IN_PROGRESS);
    });
  });

  describe('bulkEnrollMembers', () => {
    const churchClass = { id: 'class-1', name: 'New Believers' };

    it('should throw BadRequestException when the class is closed', async () => {
      mockClassRepo.findOne.mockResolvedValue({
        ...churchClass,
        status: 'CLOSED',
      });

      await expect(
        service.bulkEnrollMembers({
          classId: 'class-1',
          memberIds: ['member-1'],
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('enrols valid, not-yet-enrolled members and skips the rest, in one batched save', async () => {
      mockClassRepo.findOne.mockResolvedValue(churchClass);
      // member-3 doesn't exist; member-1 and member-2 do
      mockMemberRepo.find.mockResolvedValue([
        { id: 'member-1' },
        { id: 'member-2' },
      ]);
      // member-2 already has a COMPLETED enrollment (can't re-enrol)
      mockEnrollmentRepo.find.mockResolvedValue([
        {
          id: 'enroll-2',
          member: { id: 'member-2' },
          status: EnrollmentStatusEnum.COMPLETED,
        },
      ]);
      mockEnrollmentRepo.create.mockImplementation((x) => x);
      mockEnrollmentRepo.save.mockResolvedValue([]);

      const result = await service.bulkEnrollMembers({
        classId: 'class-1',
        memberIds: ['member-1', 'member-2', 'member-3'],
      } as any);

      expect(result).toEqual({ enrolled: 1, skipped: 2 });
      expect(mockEnrollmentRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({
          member: { id: 'member-1' },
          status: EnrollmentStatusEnum.IN_PROGRESS,
        }),
      ]);
    });

    it('resets a CANCELLED enrollment back to IN_PROGRESS as part of the same batch', async () => {
      mockClassRepo.findOne.mockResolvedValue(churchClass);
      mockMemberRepo.find.mockResolvedValue([{ id: 'member-1' }]);
      const cancelled = {
        id: 'enroll-1',
        member: { id: 'member-1' },
        status: EnrollmentStatusEnum.CANCELLED,
        cancelledAt: new Date(),
        completedAt: null,
      };
      mockEnrollmentRepo.find.mockResolvedValue([cancelled]);
      mockEnrollmentRepo.save.mockResolvedValue([]);

      const result = await service.bulkEnrollMembers({
        classId: 'class-1',
        memberIds: ['member-1'],
      } as any);

      expect(result).toEqual({ enrolled: 1, skipped: 0 });
      expect(mockEnrollmentRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({
          status: EnrollmentStatusEnum.IN_PROGRESS,
          cancelledAt: null,
        }),
      ]);
    });

    it('does not call save when every member is invalid or already enrolled', async () => {
      mockClassRepo.findOne.mockResolvedValue(churchClass);
      mockMemberRepo.find.mockResolvedValue([]);
      mockEnrollmentRepo.find.mockResolvedValue([]);

      const result = await service.bulkEnrollMembers({
        classId: 'class-1',
        memberIds: ['member-1'],
      } as any);

      expect(result).toEqual({ enrolled: 0, skipped: 1 });
      expect(mockEnrollmentRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('countActiveEnrollments', () => {
    it('should count enrollments with IN_PROGRESS status', async () => {
      mockEnrollmentRepo.count = jest.fn().mockResolvedValue(7);

      const result = await service.countActiveEnrollments();

      expect(result).toBe(7);
      expect(mockEnrollmentRepo.count).toHaveBeenCalledWith({
        where: { status: EnrollmentStatusEnum.IN_PROGRESS },
      });
    });
  });

  describe('getClassEnrollmentBreakdown', () => {
    it('should return per-class enrollment breakdown with completion rate', async () => {
      const qb = makeQb();
      qb.getRawMany = jest.fn().mockResolvedValue([
        {
          classId: 'c-1',
          className: 'Alpha',
          inProgress: '3',
          completed: '6',
          cancelled: '2',
        },
        {
          classId: 'c-2',
          className: 'Beta',
          inProgress: '1',
          completed: '0',
          cancelled: '0',
        },
      ]);
      mockClassRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getClassEnrollmentBreakdown();

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        classId: 'c-1',
        inProgress: 3,
        completed: 6,
        cancelled: 2,
        completionRate: 75, // 6 / (6+2) * 100
      });
      expect(result[1].completionRate).toBe(0); // no completed or cancelled
    });
  });

  describe('getClassCompletionsTrend', () => {
    it('should return weekly completions trend', async () => {
      const qb = makeQb();
      qb.getRawMany = jest.fn().mockResolvedValue([
        { week: '2026-05-25', completions: '3' },
        { week: '2026-06-01', completions: '5' },
      ]);
      mockEnrollmentRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);

      const result = await service.getClassCompletionsTrend(90);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ week: '2026-05-25', completions: 3 });
      expect(result[1]).toEqual({ week: '2026-06-01', completions: 5 });
    });
  });

  describe('updateEnrollmentStatus', () => {
    it('should throw NotFoundException if enrollment not found', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateEnrollmentStatus(
          'nonexistent',
          EnrollmentStatusEnum.COMPLETED,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should set completedAt when status is COMPLETED', async () => {
      const enrollment = {
        id: 'enroll-1',
        status: EnrollmentStatusEnum.IN_PROGRESS,
        completedAt: null,
        cancelledAt: null,
      };
      mockEnrollmentRepo.findOne.mockResolvedValue(enrollment);
      mockEnrollmentRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.updateEnrollmentStatus(
        'enroll-1',
        EnrollmentStatusEnum.COMPLETED,
      );

      expect(result.status).toBe(EnrollmentStatusEnum.COMPLETED);
      expect(result.completedAt).not.toBeNull();
      expect(result.cancelledAt).toBeNull();
    });

    it('should set cancelledAt when status is CANCELLED', async () => {
      const enrollment = {
        id: 'enroll-1',
        status: EnrollmentStatusEnum.IN_PROGRESS,
        completedAt: null,
        cancelledAt: null,
      };
      mockEnrollmentRepo.findOne.mockResolvedValue(enrollment);
      mockEnrollmentRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.updateEnrollmentStatus(
        'enroll-1',
        EnrollmentStatusEnum.CANCELLED,
      );

      expect(result.status).toBe(EnrollmentStatusEnum.CANCELLED);
      expect(result.cancelledAt).not.toBeNull();
      expect(result.completedAt).toBeNull();
    });

    it('should save the updated enrollment', async () => {
      const enrollment = {
        id: 'enroll-1',
        status: EnrollmentStatusEnum.IN_PROGRESS,
        completedAt: null,
        cancelledAt: null,
      };
      mockEnrollmentRepo.findOne.mockResolvedValue(enrollment);
      mockEnrollmentRepo.save.mockImplementation((e) => Promise.resolve(e));

      await service.updateEnrollmentStatus(
        'enroll-1',
        EnrollmentStatusEnum.COMPLETED,
      );

      expect(mockEnrollmentRepo.save).toHaveBeenCalled();
    });
  });

  describe('getMyEnrollments', () => {
    it('should call enrollmentRepo.find with correct where condition', async () => {
      const enrollments = [
        {
          id: 'enroll-1',
          member: { id: 'member-1' },
          churchClass: { id: 'class-1' },
        },
      ];
      mockEnrollmentRepo.find.mockResolvedValue(enrollments);

      const result = await service.getMyEnrollments('member-1');

      expect(mockEnrollmentRepo.find).toHaveBeenCalledWith({
        where: { member: { id: 'member-1' } },
        relations: ['churchClass', 'churchClass.classType'],
        order: { enrolledAt: 'DESC' },
      });
      expect(result).toEqual(enrollments);
    });

    it('should return empty array when member has no enrollments', async () => {
      mockEnrollmentRepo.find.mockResolvedValue([]);

      const result = await service.getMyEnrollments('member-no-classes');

      expect(result).toEqual([]);
    });

    it('should return all enrollments for the member', async () => {
      const enrollments = [
        { id: 'enroll-1' },
        { id: 'enroll-2' },
        { id: 'enroll-3' },
      ];
      mockEnrollmentRepo.find.mockResolvedValue(enrollments);

      const result = await service.getMyEnrollments('member-1');

      expect(result).toHaveLength(3);
    });
  });

  describe('getPromotionCandidate', () => {
    it('throws NotFoundException if enrollment does not exist', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getPromotionCandidate('nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('is not eligible when the enrollment is not COMPLETED', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue({
        id: 'enroll-1',
        status: EnrollmentStatusEnum.IN_PROGRESS,
        churchClass: {
          classType: { id: 'ct-1', nextClassType: { id: 'ct-2' } },
        },
      });

      const result = await service.getPromotionCandidate('enroll-1');

      expect(result.eligible).toBe(false);
      expect(result.openClasses).toEqual([]);
    });

    it('is not eligible when the class type is standalone (no next type)', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue({
        id: 'enroll-1',
        status: EnrollmentStatusEnum.COMPLETED,
        churchClass: { classType: { id: 'ct-1', nextClassType: null } },
      });

      const result = await service.getPromotionCandidate('enroll-1');

      expect(result.eligible).toBe(false);
    });

    it('returns open classes of the next type when eligible', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue({
        id: 'enroll-1',
        status: EnrollmentStatusEnum.COMPLETED,
        churchClass: {
          classType: { id: 'ct-1', nextClassType: { id: 'ct-2' } },
        },
      });
      const openClasses = [{ id: 'class-2', name: 'Workers in Training' }];
      mockClassRepo.find.mockResolvedValue(openClasses);

      const result = await service.getPromotionCandidate('enroll-1');

      expect(result.eligible).toBe(true);
      expect(result.nextClassType).toEqual({ id: 'ct-2' });
      expect(result.openClasses).toEqual(openClasses);
      expect(mockClassRepo.find).toHaveBeenCalledWith({
        where: {
          classType: { id: 'ct-2' },
          status: ChurchClassStatusEnum.ACTIVE,
        },
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('promoteEnrollment', () => {
    const baseEnrollment = {
      id: 'enroll-1',
      member: {
        id: 'member-1',
        email: 'a@b.com',
        firstname: 'Ada',
        lastname: 'Lovelace',
      },
      status: EnrollmentStatusEnum.COMPLETED,
      churchClass: {
        id: 'class-1',
        name: 'Believers Class',
        classType: { id: 'ct-1', nextClassType: { id: 'ct-2' } },
      },
    };

    it('throws NotFoundException if enrollment does not exist', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue(null);

      await expect(
        service.promoteEnrollment(
          'nonexistent',
          { targetClassId: 'class-2' },
          'admin-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if enrollment is not COMPLETED', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue({
        ...baseEnrollment,
        status: EnrollmentStatusEnum.IN_PROGRESS,
      });

      await expect(
        service.promoteEnrollment(
          'enroll-1',
          { targetClassId: 'class-2' },
          'admin-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the class type is standalone', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue({
        ...baseEnrollment,
        churchClass: {
          ...baseEnrollment.churchClass,
          classType: { id: 'ct-1', nextClassType: null },
        },
      });

      await expect(
        service.promoteEnrollment(
          'enroll-1',
          { targetClassId: 'class-2' },
          'admin-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException if the target class does not exist', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue(baseEnrollment);
      mockClassRepo.findOne.mockResolvedValue(null);

      await expect(
        service.promoteEnrollment(
          'enroll-1',
          { targetClassId: 'class-2' },
          'admin-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if target class is not of the expected next type', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue(baseEnrollment);
      mockClassRepo.findOne.mockResolvedValue({
        id: 'class-2',
        classType: { id: 'ct-3' },
      });

      await expect(
        service.promoteEnrollment(
          'enroll-1',
          { targetClassId: 'class-2' },
          'admin-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('enrolls the member into the target class, logs, and emails on success', async () => {
      mockEnrollmentRepo.findOne
        .mockResolvedValueOnce(baseEnrollment) // load the enrollment being promoted
        .mockResolvedValueOnce(null); // enrollMember's existing-enrollment check — none, create fresh
      mockClassRepo.findOne
        .mockResolvedValueOnce({ id: 'class-2', classType: { id: 'ct-2' } }) // target class type check
        .mockResolvedValueOnce({
          id: 'class-2',
          name: 'Workers in Training',
          status: ChurchClassStatusEnum.ACTIVE,
        }); // getClassOrThrow inside enrollMember
      mockMemberRepo.existsBy.mockResolvedValue(true);
      const newEnrollment = {
        id: 'enroll-2',
        status: EnrollmentStatusEnum.IN_PROGRESS,
      };
      mockEnrollmentRepo.create.mockReturnValue(newEnrollment);
      mockEnrollmentRepo.save.mockResolvedValue(newEnrollment);

      const result = await service.promoteEnrollment(
        'enroll-1',
        { targetClassId: 'class-2' },
        'admin-1',
      );

      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'CLASS_LEVEL_PROMOTED',
        expect.objectContaining({
          actorId: 'admin-1',
          targetId: 'member-1',
        }),
      );
      expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalled();
      expect(result).toBe(newEnrollment);
    });
  });

  describe('issueCertificate', () => {
    const completedEnrollment = {
      id: 'enroll-1',
      status: EnrollmentStatusEnum.COMPLETED,
      member: {
        id: 'member-1',
        email: 'a@b.com',
        firstname: 'Ada',
        lastname: 'Lovelace',
      },
      churchClass: { id: 'class-1', name: 'Believers Class' },
      certificateIssued: false,
      certificateIssuedAt: null,
      certificateNumber: null,
    };

    it('throws NotFoundException if enrollment does not exist', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue(null);

      await expect(
        service.issueCertificate('nonexistent', {}, 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if enrollment is not COMPLETED', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue({
        ...completedEnrollment,
        status: EnrollmentStatusEnum.IN_PROGRESS,
      });

      await expect(
        service.issueCertificate('enroll-1', {}, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('marks the certificate issued, sets the number, and audit-logs', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue({ ...completedEnrollment });
      mockEnrollmentRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.issueCertificate(
        'enroll-1',
        { certificateNumber: 'CERT-001' },
        'admin-1',
      );

      expect(result.certificateIssued).toBe(true);
      expect(result.certificateIssuedAt).toBeInstanceOf(Date);
      expect(result.certificateNumber).toBe('CERT-001');
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'CLASS_CERTIFICATE_ISSUED',
        expect.objectContaining({
          actorId: 'admin-1',
          targetId: 'member-1',
          metadata: expect.objectContaining({
            enrollmentId: 'enroll-1',
            certificateNumber: 'CERT-001',
          }),
        }),
      );
    });

    it('defaults certificateNumber to null when not provided', async () => {
      mockEnrollmentRepo.findOne.mockResolvedValue({ ...completedEnrollment });
      mockEnrollmentRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.issueCertificate('enroll-1', {}, 'admin-1');

      expect(result.certificateNumber).toBeNull();
    });
  });

  describe('updateClassSession', () => {
    it('throws NotFoundException if the class does not exist', async () => {
      mockClassRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateClassSession('nonexistent', {
          nextSessionAt: '2026-09-01T18:00:00.000Z',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('sets nextSessionAt and meetingLink when provided', async () => {
      const churchClass = {
        id: 'class-1',
        name: 'Marriage Counselling',
        nextSessionAt: null,
        meetingLink: null,
      };
      mockClassRepo.findOne.mockResolvedValue(churchClass);
      mockClassRepo.save.mockImplementation((c) => Promise.resolve(c));

      const result = await service.updateClassSession('class-1', {
        nextSessionAt: '2026-09-01T18:00:00.000Z',
        meetingLink: 'https://meet.example.com/abc',
      });

      expect(result.nextSessionAt).toEqual(
        new Date('2026-09-01T18:00:00.000Z'),
      );
      expect(result.meetingLink).toBe('https://meet.example.com/abc');
    });

    it('clears nextSessionAt when explicitly set to null', async () => {
      const churchClass = {
        id: 'class-1',
        nextSessionAt: new Date(),
        meetingLink: 'https://meet.example.com/abc',
      };
      mockClassRepo.findOne.mockResolvedValue(churchClass);
      mockClassRepo.save.mockImplementation((c) => Promise.resolve(c));

      const result = await service.updateClassSession('class-1', {
        nextSessionAt: null,
      });

      expect(result.nextSessionAt).toBeNull();
      expect(result.meetingLink).toBe('https://meet.example.com/abc');
    });
  });

  describe('getClassLookup', () => {
    it('returns id/name/startDate/endDate for every class', async () => {
      const classes = [
        {
          id: 'class-1',
          name: 'Alpha',
          startDate: '2026-01-01',
          endDate: '2026-03-01',
        },
      ];
      mockClassRepo.find.mockResolvedValue(classes);

      const result = await service.getClassLookup();

      expect(mockClassRepo.find).toHaveBeenCalledWith({
        select: ['id', 'name', 'startDate', 'endDate'],
        order: { createdAt: 'DESC' },
      });
      expect(result).toEqual(classes);
    });
  });

  describe('getMemberIdsForClass', () => {
    it('returns member ids for In Progress/Completed enrollments, excluding guest-only rows', async () => {
      const qb = makeQb();
      qb.getRawMany = jest
        .fn()
        .mockResolvedValue([
          { memberId: 'member-1' },
          { memberId: 'member-2' },
        ]);
      mockEnrollmentRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getMemberIdsForClass('class-1');

      expect(result).toEqual(['member-1', 'member-2']);
      expect(qb.andWhere).toHaveBeenCalledWith('e.status IN (:...statuses)', {
        statuses: [
          EnrollmentStatusEnum.IN_PROGRESS,
          EnrollmentStatusEnum.COMPLETED,
        ],
      });
    });
  });

  describe('getGuestPhonesForClass', () => {
    it('returns only non-null guest phone numbers', async () => {
      const qb = makeQb();
      qb.getRawMany = jest
        .fn()
        .mockResolvedValue([{ phone: '+1111111111' }, { phone: null }]);
      mockEnrollmentRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getGuestPhonesForClass('class-1');

      expect(result).toEqual(['+1111111111']);
    });
  });

  describe('enrollGuest', () => {
    const churchClass = {
      id: 'class-1',
      name: 'Marriage Counselling',
      status: ChurchClassStatusEnum.ACTIVE,
    };

    it('throws BadRequestException when the class is closed', async () => {
      mockClassRepo.findOne.mockResolvedValue({
        ...churchClass,
        status: ChurchClassStatusEnum.CLOSED,
      });

      await expect(
        service.enrollGuest({
          classId: 'class-1',
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@example.com',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('finds-or-creates the guest by email, creates a fresh enrollment, and sends the portal access email', async () => {
      mockClassRepo.findOne.mockResolvedValue(churchClass);
      const guest = {
        id: 'guest-1',
        email: 'jane@example.com',
        firstName: 'Jane',
      };
      mockGuestService.findOrCreateByEmail.mockResolvedValue(guest);
      mockEnrollmentRepo.findOne.mockResolvedValue(null);
      const enrollment = {
        id: 'enroll-1',
        guest,
        status: EnrollmentStatusEnum.IN_PROGRESS,
      };
      mockEnrollmentRepo.create.mockReturnValue(enrollment);
      mockEnrollmentRepo.save.mockResolvedValue(enrollment);

      const result = await service.enrollGuest({
        classId: 'class-1',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
      } as any);

      expect(mockGuestService.findOrCreateByEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          firstName: 'Jane',
          email: 'jane@example.com',
        }),
      );
      expect(mockEnrollmentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          guest,
          status: EnrollmentStatusEnum.IN_PROGRESS,
        }),
      );
      expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalled();
      expect(result).toBe(enrollment);
    });

    it('looks up the guest by id instead of by email when guestId is provided', async () => {
      mockClassRepo.findOne.mockResolvedValue(churchClass);
      const guest = { id: 'guest-1', email: 'jane@example.com' };
      mockGuestService.getById.mockResolvedValue(guest);
      mockEnrollmentRepo.findOne.mockResolvedValue(null);
      const enrollment = { id: 'enroll-1', guest };
      mockEnrollmentRepo.create.mockReturnValue(enrollment);
      mockEnrollmentRepo.save.mockResolvedValue(enrollment);

      await service.enrollGuest({
        classId: 'class-1',
        guestId: 'guest-1',
      } as any);

      expect(mockGuestService.getById).toHaveBeenCalledWith('guest-1');
      expect(mockGuestService.findOrCreateByEmail).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the guest already completed this class', async () => {
      mockClassRepo.findOne.mockResolvedValue(churchClass);
      mockGuestService.getById.mockResolvedValue({ id: 'guest-1' });
      mockEnrollmentRepo.findOne.mockResolvedValue({
        id: 'enroll-1',
        status: EnrollmentStatusEnum.COMPLETED,
      });

      await expect(
        service.enrollGuest({ classId: 'class-1', guestId: 'guest-1' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('re-enrols a CANCELLED guest enrollment back to IN_PROGRESS without sending a new portal email', async () => {
      mockClassRepo.findOne.mockResolvedValue(churchClass);
      mockGuestService.getById.mockResolvedValue({ id: 'guest-1' });
      const cancelled = {
        id: 'enroll-1',
        status: EnrollmentStatusEnum.CANCELLED,
        cancelledAt: new Date(),
        completedAt: null,
      };
      mockEnrollmentRepo.findOne.mockResolvedValue(cancelled);
      mockEnrollmentRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.enrollGuest({
        classId: 'class-1',
        guestId: 'guest-1',
      } as any);

      expect(result.status).toBe(EnrollmentStatusEnum.IN_PROGRESS);
      expect(mockEnrollmentRepo.create).not.toHaveBeenCalled();
      expect(mockUtilityService.sendEmailWithTemplate).not.toHaveBeenCalled();
    });
  });

  describe('bulkEnrollGuests', () => {
    const churchClass = {
      id: 'class-1',
      name: 'Marriage Counselling',
      status: ChurchClassStatusEnum.ACTIVE,
    };

    it('throws BadRequestException when the class is closed', async () => {
      mockClassRepo.findOne.mockResolvedValue({
        ...churchClass,
        status: ChurchClassStatusEnum.CLOSED,
      });

      await expect(
        service.bulkEnrollGuests({
          classId: 'class-1',
          guests: [{ firstName: 'Jane', lastName: 'Doe', email: 'a@b.com' }],
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('enrols valid entries and skips ones that fail, without aborting the batch', async () => {
      mockClassRepo.findOne.mockResolvedValue(churchClass);
      mockGuestService.findOrCreateByEmail
        .mockResolvedValueOnce({ id: 'guest-1', email: 'a@b.com' })
        .mockRejectedValueOnce(new Error('boom'));
      mockEnrollmentRepo.findOne.mockResolvedValue(null);
      mockEnrollmentRepo.create.mockImplementation((x) => x);
      mockEnrollmentRepo.save.mockImplementation((x) =>
        Promise.resolve({ id: 'enroll-1', ...x }),
      );

      const result = await service.bulkEnrollGuests({
        classId: 'class-1',
        guests: [
          { firstName: 'Jane', lastName: 'Doe', email: 'a@b.com' },
          { firstName: 'John', lastName: 'Smith', email: 'c@d.com' },
        ],
      } as any);

      expect(result).toEqual({ enrolled: 1, skipped: 1 });
    });
  });

  describe('uploadClassMaterial', () => {
    const churchClass = { id: 'class-1', name: 'New Believers' };
    const file = {
      buffer: Buffer.from('pdf-bytes'),
      mimetype: 'application/pdf',
      originalname: 'Syllabus.pdf',
      size: 12345,
    } as Express.Multer.File;

    it('uploads to the class-materials Cloudinary folder and creates a material row', async () => {
      mockClassRepo.findOne.mockResolvedValue(churchClass);
      mockCloudinaryService.uploadBuffer.mockResolvedValue({
        secureUrl: 'https://res.cloudinary.com/x/class-materials/123.pdf',
        publicId: 'class-materials/123',
        resourceType: 'raw',
      });
      mockMaterialRepo.count.mockResolvedValue(0);
      mockMaterialRepo.create.mockImplementation((v) => v);
      mockMaterialRepo.save.mockImplementation((v) =>
        Promise.resolve({ id: 'material-1', ...v }),
      );

      const result = await service.uploadClassMaterial(
        'class-1',
        file,
        'My Title',
      );

      expect(mockCloudinaryService.uploadBuffer).toHaveBeenCalledWith(
        expect.any(Buffer),
        'class-materials',
        undefined,
        'application/pdf',
      );
      expect(mockMaterialRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'My Title',
          url: 'https://res.cloudinary.com/x/class-materials/123.pdf',
          publicId: 'class-materials/123',
          resourceType: 'raw',
          mimeType: 'application/pdf',
          sizeBytes: 12345,
          order: 0,
        }),
      );
      expect(result.id).toBe('material-1');
    });

    it('defaults the title to the original filename (extension stripped) when omitted', async () => {
      mockClassRepo.findOne.mockResolvedValue(churchClass);
      mockCloudinaryService.uploadBuffer.mockResolvedValue({
        secureUrl: 'https://x/y.pdf',
        publicId: 'class-materials/456',
        resourceType: 'raw',
      });
      mockMaterialRepo.count.mockResolvedValue(2);
      mockMaterialRepo.create.mockImplementation((v) => v);
      mockMaterialRepo.save.mockImplementation((v) => Promise.resolve(v));

      await service.uploadClassMaterial('class-1', file, undefined);

      expect(mockMaterialRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Syllabus', order: 2 }),
      );
    });

    it('throws NotFoundException when the class does not exist', async () => {
      mockClassRepo.findOne.mockResolvedValue(null);
      await expect(
        service.uploadClassMaterial('missing', file, 'Title'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('addClassMaterialLink', () => {
    it('creates a material row with no publicId', async () => {
      mockClassRepo.findOne.mockResolvedValue({ id: 'class-1', name: 'Class' });
      mockMaterialRepo.count.mockResolvedValue(0);
      mockMaterialRepo.create.mockImplementation((v) => v);
      mockMaterialRepo.save.mockImplementation((v) =>
        Promise.resolve({ id: 'material-1', ...v }),
      );

      const result = await service.addClassMaterialLink('class-1', {
        title: 'Recommended Reading',
        url: 'https://drive.google.com/xyz',
      });

      expect(mockMaterialRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Recommended Reading',
          url: 'https://drive.google.com/xyz',
          publicId: null,
        }),
      );
      expect(result.id).toBe('material-1');
    });
  });

  describe('reuseClassMaterial', () => {
    it('creates a new row pointing at the same asset without a new upload', async () => {
      mockClassRepo.findOne.mockResolvedValue({
        id: 'class-2',
        name: 'Cohort 2',
      });
      mockMaterialRepo.count.mockResolvedValue(0);
      mockMaterialRepo.create.mockImplementation((v) => v);
      mockMaterialRepo.save.mockImplementation((v) =>
        Promise.resolve({ id: 'material-2', ...v }),
      );

      await service.reuseClassMaterial('class-2', {
        title: 'Syllabus',
        url: 'https://res.cloudinary.com/x/class-materials/123.pdf',
        publicId: 'class-materials/123',
        resourceType: 'raw',
      });

      expect(mockCloudinaryService.uploadBuffer).not.toHaveBeenCalled();
      expect(mockMaterialRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ publicId: 'class-materials/123' }),
      );
    });
  });

  describe('removeClassMaterial', () => {
    it('throws NotFoundException when the material does not belong to the class', async () => {
      mockMaterialRepo.findOne.mockResolvedValue(null);
      await expect(
        service.removeClassMaterial('class-1', 'material-x'),
      ).rejects.toThrow(NotFoundException);
    });

    it('deletes the Cloudinary asset when no other material shares its publicId', async () => {
      const material = {
        id: 'material-1',
        publicId: 'class-materials/123',
        resourceType: 'raw',
      };
      mockMaterialRepo.findOne.mockResolvedValue(material);
      mockMaterialRepo.exists.mockResolvedValue(false);

      await service.removeClassMaterial('class-1', 'material-1');

      expect(mockMaterialRepo.remove).toHaveBeenCalledWith(material);
      expect(mockCloudinaryService.deleteByPublicId).toHaveBeenCalledWith(
        'class-materials/123',
        'raw',
      );
    });

    it('does NOT delete the Cloudinary asset when another material still references it', async () => {
      const material = {
        id: 'material-1',
        publicId: 'class-materials/123',
        resourceType: 'raw',
      };
      mockMaterialRepo.findOne.mockResolvedValue(material);
      mockMaterialRepo.exists.mockResolvedValue(true); // another row shares this publicId

      await service.removeClassMaterial('class-1', 'material-1');

      expect(mockMaterialRepo.remove).toHaveBeenCalledWith(material);
      expect(mockCloudinaryService.deleteByPublicId).not.toHaveBeenCalled();
    });

    it('never calls Cloudinary for a pasted-link material (no publicId)', async () => {
      const material = { id: 'material-1', publicId: null, resourceType: null };
      mockMaterialRepo.findOne.mockResolvedValue(material);

      await service.removeClassMaterial('class-1', 'material-1');

      expect(mockMaterialRepo.exists).not.toHaveBeenCalled();
      expect(mockCloudinaryService.deleteByPublicId).not.toHaveBeenCalled();
    });
  });

  describe('getMaterialLibrary', () => {
    it('dedups uploads by publicId and groups by the class names that use them', async () => {
      mockMaterialRepo.find.mockResolvedValue([
        {
          title: 'Manual',
          url: 'https://x/manual.pdf',
          publicId: 'class-materials/1',
          resourceType: 'raw',
          mimeType: 'application/pdf',
          sizeBytes: 100,
          churchClass: { name: 'New Believers 1' },
        },
        {
          title: 'Manual',
          url: 'https://x/manual.pdf',
          publicId: 'class-materials/1',
          resourceType: 'raw',
          mimeType: 'application/pdf',
          sizeBytes: 100,
          churchClass: { name: 'New Believers 2' },
        },
        {
          title: 'Baptism Guide',
          url: 'https://x/baptism.pdf',
          publicId: 'class-materials/2',
          resourceType: 'raw',
          mimeType: 'application/pdf',
          sizeBytes: 200,
          churchClass: { name: 'Water Baptism' },
        },
      ]);

      const result = await service.getMaterialLibrary();

      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            publicId: 'class-materials/1',
            usedByClassNames: ['New Believers 1', 'New Believers 2'],
          }),
          expect.objectContaining({
            publicId: 'class-materials/2',
            usedByClassNames: ['Water Baptism'],
          }),
        ]),
      );
      expect(result).toHaveLength(2);
    });

    it('dedups pasted links by URL when publicId is null', async () => {
      mockMaterialRepo.find.mockResolvedValue([
        {
          title: 'Reading',
          url: 'https://drive.google.com/xyz',
          publicId: null,
          resourceType: null,
          mimeType: null,
          sizeBytes: null,
          churchClass: { name: 'Class A' },
        },
        {
          title: 'Reading',
          url: 'https://drive.google.com/xyz',
          publicId: null,
          resourceType: null,
          mimeType: null,
          sizeBytes: null,
          churchClass: { name: 'Class B' },
        },
      ]);

      const result = await service.getMaterialLibrary();

      expect(result).toEqual([
        expect.objectContaining({
          url: 'https://drive.google.com/xyz',
          usedByClassNames: ['Class A', 'Class B'],
        }),
      ]);
    });

    it('returns an empty array when no materials exist yet', async () => {
      mockMaterialRepo.find.mockResolvedValue([]);
      const result = await service.getMaterialLibrary();
      expect(result).toEqual([]);
    });
  });

  describe('deleteClass', () => {
    it('cleans up each material Cloudinary asset before removing the class', async () => {
      const churchClass = { id: 'class-1', name: 'New Believers' };
      mockClassRepo.findOne.mockResolvedValue(churchClass);
      mockEnrollmentRepo.count.mockResolvedValue(0);
      mockMaterialRepo.find.mockResolvedValue([
        { id: 'm-1', publicId: 'class-materials/1', resourceType: 'raw' },
        { id: 'm-2', publicId: null, resourceType: null },
      ]);
      mockMaterialRepo.exists.mockResolvedValue(false);

      await service.deleteClass('class-1');

      expect(mockCloudinaryService.deleteByPublicId).toHaveBeenCalledTimes(1);
      expect(mockCloudinaryService.deleteByPublicId).toHaveBeenCalledWith(
        'class-materials/1',
        'raw',
      );
      expect(mockClassRepo.remove).toHaveBeenCalledWith(churchClass);
    });

    it('still blocks deletion when the class has enrollments, before touching materials', async () => {
      mockClassRepo.findOne.mockResolvedValue({ id: 'class-1', name: 'X' });
      mockEnrollmentRepo.count.mockResolvedValue(3);

      await expect(service.deleteClass('class-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockMaterialRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('getClass', () => {
    it('returns the class with materials sorted by order', async () => {
      mockClassRepo.findOne.mockResolvedValue({
        id: 'class-1',
        materials: [
          { id: 'm-2', order: 2 },
          { id: 'm-1', order: 0 },
          { id: 'm-3', order: 1 },
        ],
      });

      const result = await service.getClass('class-1');

      expect(result.materials.map((m) => m.id)).toEqual(['m-1', 'm-3', 'm-2']);
    });

    it('returns the class with facilitators sorted by order', async () => {
      mockClassRepo.findOne.mockResolvedValue({
        id: 'class-1',
        facilitators: [
          { id: 'f-2', order: 2 },
          { id: 'f-1', order: 0 },
          { id: 'f-3', order: 1 },
        ],
      });

      const result = await service.getClass('class-1');

      expect(result.facilitators.map((f) => f.id)).toEqual([
        'f-1',
        'f-3',
        'f-2',
      ]);
    });
  });
});
