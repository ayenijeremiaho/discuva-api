import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClassesService } from './classes.service';
import { ChurchClass } from '../entity/church-class.entity';
import { ClassEnrollment } from '../entity/class-enrollment.entity';
import { Member } from '../../member/entity/member.entity';
import { EnrollmentStatusEnum } from '../enum/enrollment-status.enum';
import { ChurchClassStatusEnum } from '../enum/church-class-status.enum';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { UtilityService } from '../../utility/service/utility.service';

const makeQb = () => ({
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  leftJoin: jest.fn().mockReturnThis(),
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

const mockAuditLogService = { log: jest.fn() };

const mockUtilityService = {
  sendEmailWithTemplate: jest.fn(),
};

const mockConfigService = {
  get: jest.fn(),
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
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: UtilityService, useValue: mockUtilityService },
        { provide: ConfigService, useValue: mockConfigService },
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

    it('should set facilitator to null when no facilitatorId provided', async () => {
      const dto = { name: 'Class', classTypeId: 'class-type-1' };
      mockClassRepo.create.mockReturnValue({ ...dto, facilitator: null });
      mockClassRepo.save.mockResolvedValue({
        id: 'class-1',
        ...dto,
        facilitator: null,
      });

      await service.createClass(dto as any);

      expect(mockClassRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ facilitator: null }),
      );
    });

    it('should set facilitator as reference when facilitatorId provided', async () => {
      const dto = {
        name: 'Class',
        classTypeId: 'class-type-1',
        facilitatorId: 'member-1',
      };
      mockClassRepo.create.mockReturnValue({
        ...dto,
        facilitator: { id: 'member-1' },
      });
      mockClassRepo.save.mockResolvedValue({
        id: 'class-1',
        facilitator: { id: 'member-1' },
      });

      await service.createClass(dto as any);

      expect(mockClassRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ facilitator: { id: 'member-1' } }),
      );
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
});
