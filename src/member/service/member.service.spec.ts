import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { MemberService } from './member.service';
import { Member } from '../entity/member.entity';
import { WorkerProfile } from '../entity/worker-profile.entity';
import { Clergy } from '../entity/clergy.entity';
import { ClergyTitle } from '../../clergy-title/entity/clergy-title.entity';
import { Department } from '../../department/entity/department.entity';
import { DepartmentLead } from '../../department/entity/department-lead.entity';
import { SundaySchoolClass } from '../../sunday-school/entity/sunday-school-class.entity';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { MemberSessionService } from './member-session.service';
import { ConfigService } from '@nestjs/config';
import { MemberRoleEnum } from '../enums/member-role.enum';
import { MemberStatusEnum } from '../enums/member-status.enum';
import { WorkerStatusEnum } from '../enums/worker-status.enum';
import { SessionSurface } from '../../auth/enum/session-surface.enum';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';
import { CloudinaryService } from '../../utility/service/cloudinary.service';

const mockMemberRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  findAndCount: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  create: jest.fn(),
  exists: jest.fn(),
  count: jest.fn(),
  createQueryBuilder: jest.fn(),
  manager: {
    transaction: jest.fn(),
  },
};

const mockWorkerProfileRepo = {
  save: jest.fn(),
  create: jest.fn(),
  remove: jest.fn(),
  findOne: jest.fn(),
};

const mockDepartmentRepo = {
  findOneBy: jest.fn(),
};

const mockClergyRepo = {
  save: jest.fn(),
  create: jest.fn(),
  remove: jest.fn(),
  findOne: jest.fn(),
};

const mockClergyTitleRepo = {
  findOneBy: jest.fn(),
};

const mockUtilityService = {
  sendEmailWithTemplate: jest.fn(),
  sendEmail: jest.fn(),
  resolveChurchName: jest.fn(),
};

const mockAuditLogService = { log: jest.fn() };

const mockSessionService = { updateLogout: jest.fn() };

const mockConfigService = { get: jest.fn() };

const mockPushService = { unsubscribe: jest.fn() };

const mockCloudinaryService = {
  uploadBuffer: jest.fn().mockResolvedValue({
    secureUrl:
      'https://res.cloudinary.com/test/image/upload/v1/profile-pictures/photo.jpg',
    publicId: 'profile-pictures/photo',
    resourceType: 'image',
  }),
  deleteByPublicId: jest.fn().mockResolvedValue(undefined),
};

function mockCredentialsQb(member: object) {
  const qb = {
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(member),
  };
  mockMemberRepo.createQueryBuilder.mockReturnValue(qb);
  return qb;
}

describe('MemberService', () => {
  let service: MemberService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockUtilityService.resolveChurchName.mockResolvedValue('Test Church');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemberService,
        { provide: getRepositoryToken(Member), useValue: mockMemberRepo },
        {
          provide: getRepositoryToken(WorkerProfile),
          useValue: mockWorkerProfileRepo,
        },
        {
          provide: getRepositoryToken(Clergy),
          useValue: mockClergyRepo,
        },
        {
          provide: getRepositoryToken(ClergyTitle),
          useValue: mockClergyTitleRepo,
        },
        {
          provide: getRepositoryToken(Department),
          useValue: mockDepartmentRepo,
        },
        { provide: UtilityService, useValue: mockUtilityService },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: MemberSessionService, useValue: mockSessionService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PushNotificationService, useValue: mockPushService },
        { provide: CloudinaryService, useValue: mockCloudinaryService },
      ],
    }).compile();

    service = module.get<MemberService>(MemberService);
  });

  describe('signup', () => {
    it('should throw ConflictException when email already exists', async () => {
      mockMemberRepo.exists.mockResolvedValue(true);

      await expect(
        service.signup({
          email: 'existing@test.com',
          password: 'pass',
          firstname: 'John',
          lastname: 'Doe',
        } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('should save member with MEMBER role and ACTIVE status on success', async () => {
      mockMemberRepo.exists.mockResolvedValue(false);
      jest.spyOn(UtilityService, 'hashValue').mockResolvedValue('hashed_pass');
      jest
        .spyOn(UtilityService, 'capitalizeFirstLetter')
        .mockReturnValue('John');

      const createdMember = {
        id: 'uuid-1',
        email: 'new@test.com',
        firstname: 'john',
        role: MemberRoleEnum.MEMBER,
        status: MemberStatusEnum.ACTIVE,
      };
      mockMemberRepo.create.mockReturnValue(createdMember);
      mockMemberRepo.save.mockResolvedValue(createdMember);

      const result = await service.signup({
        email: 'new@test.com',
        password: 'pass123',
        firstname: 'john',
        lastname: 'doe',
      } as any);

      expect(mockMemberRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          role: MemberRoleEnum.MEMBER,
          status: MemberStatusEnum.ACTIVE,
          password: 'hashed_pass',
        }),
      );
      expect(mockMemberRepo.save).toHaveBeenCalledWith(createdMember);
      expect(result.role).toBe(MemberRoleEnum.MEMBER);
      expect(result.status).toBe(MemberStatusEnum.ACTIVE);
    });

    it('should send welcome email after successful signup', async () => {
      mockMemberRepo.exists.mockResolvedValue(false);
      jest.spyOn(UtilityService, 'hashValue').mockResolvedValue('hashed_pass');
      jest
        .spyOn(UtilityService, 'capitalizeFirstLetter')
        .mockReturnValue('John');

      const savedMember = {
        id: 'uuid-1',
        email: 'new@test.com',
        firstname: 'john',
      };
      mockMemberRepo.create.mockReturnValue(savedMember);
      mockMemberRepo.save.mockResolvedValue(savedMember);

      await service.signup({
        email: 'new@test.com',
        password: 'pass',
        firstname: 'john',
        lastname: 'doe',
      } as any);

      expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
        savedMember.email,
        expect.any(String),
        'welcome-member',
        expect.any(Object),
      );
    });
  });

  describe('createByAdmin', () => {
    it('creates the member the same way as signup (temp password, MEMBER/ACTIVE, welcome email)', async () => {
      mockMemberRepo.exists.mockResolvedValue(false);
      jest.spyOn(UtilityService, 'hashValue').mockResolvedValue('hashed_pass');
      jest
        .spyOn(UtilityService, 'capitalizeFirstLetter')
        .mockReturnValue('John');

      const createdMember = {
        id: 'uuid-2',
        email: 'created@test.com',
        firstname: 'John',
        lastname: 'Doe',
        role: MemberRoleEnum.MEMBER,
        status: MemberStatusEnum.ACTIVE,
      };
      mockMemberRepo.create.mockReturnValue(createdMember);
      mockMemberRepo.save.mockResolvedValue(createdMember);

      const result = await service.createByAdmin(
        {
          email: 'created@test.com',
          firstname: 'John',
          lastname: 'Doe',
        } as any,
        'admin-1',
      );

      expect(result.role).toBe(MemberRoleEnum.MEMBER);
      expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
        createdMember.email,
        expect.any(String),
        'welcome-member',
        expect.objectContaining({ password: expect.any(String) }),
      );
    });

    it('audit-logs MEMBER_CREATED_BY_ADMIN with the admin as actor, not MEMBER_SIGNED_UP', async () => {
      mockMemberRepo.exists.mockResolvedValue(false);
      jest.spyOn(UtilityService, 'hashValue').mockResolvedValue('hashed_pass');
      jest
        .spyOn(UtilityService, 'capitalizeFirstLetter')
        .mockReturnValue('John');

      const createdMember = {
        id: 'uuid-2',
        email: 'created@test.com',
        firstname: 'John',
        lastname: 'Doe',
      };
      mockMemberRepo.create.mockReturnValue(createdMember);
      mockMemberRepo.save.mockResolvedValue(createdMember);

      await service.createByAdmin(
        {
          email: 'created@test.com',
          firstname: 'John',
          lastname: 'Doe',
        } as any,
        'admin-1',
      );

      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'MEMBER_CREATED_BY_ADMIN',
        expect.objectContaining({ actorId: 'admin-1', targetId: 'uuid-2' }),
      );
    });

    it('throws ConflictException when the email already exists', async () => {
      mockMemberRepo.exists.mockResolvedValue(true);

      await expect(
        service.createByAdmin(
          {
            email: 'existing@test.com',
            firstname: 'John',
            lastname: 'Doe',
          } as any,
          'admin-1',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('promoteToWorker', () => {
    it('should throw BadRequestException if member is already a worker', async () => {
      const memberWithProfile = {
        id: 'member-1',
        role: MemberRoleEnum.WORKER,
        workerProfile: { id: 'wp-1', status: WorkerStatusEnum.ACTIVE },
      };
      mockMemberRepo.findOne.mockResolvedValue(memberWithProfile);

      await expect(
        service.promoteToWorker(
          'member-1',
          { departmentId: 'dept-1' } as any,
          'actor-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if department not found', async () => {
      const member = {
        id: 'member-1',
        role: MemberRoleEnum.MEMBER,
        workerProfile: null,
      };
      mockMemberRepo.findOne.mockResolvedValue(member);
      mockDepartmentRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.promoteToWorker(
          'member-1',
          { departmentId: 'nonexistent-dept' } as any,
          'actor-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should set role to WORKER and create worker profile on success', async () => {
      const member = {
        id: 'member-1',
        email: 'worker@test.com',
        firstname: 'Jane',
        lastname: 'Doe',
        role: MemberRoleEnum.MEMBER,
        workerProfile: null,
      };
      const department = { id: 'dept-1', name: 'Music' };
      const workerProfile = { id: 'wp-1', status: WorkerStatusEnum.ACTIVE };
      const updatedMember = {
        ...member,
        role: MemberRoleEnum.WORKER,
        workerProfile,
      };
      const mockTxManager = {
        save: jest.fn().mockResolvedValue(workerProfile),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };

      mockMemberRepo.findOne
        .mockResolvedValueOnce(member)
        .mockResolvedValueOnce(updatedMember);
      mockDepartmentRepo.findOneBy.mockResolvedValue(department);
      mockWorkerProfileRepo.create.mockReturnValue(workerProfile);
      mockMemberRepo.manager.transaction.mockImplementation(
        async (cb: (em: typeof mockTxManager) => Promise<void>) =>
          cb(mockTxManager),
      );
      jest
        .spyOn(UtilityService, 'capitalizeFirstLetter')
        .mockReturnValue('Jane');

      const result = await service.promoteToWorker(
        'member-1',
        { departmentId: 'dept-1' } as any,
        'actor-1',
      );

      expect(mockTxManager.save).toHaveBeenCalledWith(workerProfile);
      expect(mockTxManager.update).toHaveBeenCalledWith(Member, 'member-1', {
        role: MemberRoleEnum.WORKER,
      });
      expect(result.role).toBe(MemberRoleEnum.WORKER);
      // The subject must name the tenant's own church (resolved per-request
      // via EmailQueueService), never the generic SaaS product name — this
      // used to read "Welcome to Discuva Workforce" for every tenant.
      expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
        member.email,
        'Jane, Welcome to Test Church Workforce',
        'welcome-worker',
        expect.any(Object),
      );
    });

    it('reactivates a previously revoked WorkerProfile instead of creating a new one, preserving prior progress', async () => {
      const existingProfile = {
        id: 'wp-1',
        status: WorkerStatusEnum.INACTIVE,
        profession: 'Accountant',
        completedSOD: true,
        completedBibleCollege: false,
        isTrainee: true,
      };
      const member = {
        id: 'member-1',
        email: 'worker@test.com',
        firstname: 'Jane',
        lastname: 'Doe',
        role: MemberRoleEnum.MEMBER,
        workerProfile: existingProfile,
      };
      const department = { id: 'dept-2', name: 'Media' };
      const mockTxManager = {
        save: jest.fn().mockResolvedValue(existingProfile),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };

      mockMemberRepo.findOne
        .mockResolvedValueOnce(member)
        .mockResolvedValueOnce({ ...member, role: MemberRoleEnum.WORKER });
      mockDepartmentRepo.findOneBy.mockResolvedValue(department);
      mockMemberRepo.manager.transaction.mockImplementation(
        async (cb: (em: typeof mockTxManager) => Promise<void>) =>
          cb(mockTxManager),
      );
      jest
        .spyOn(UtilityService, 'capitalizeFirstLetter')
        .mockReturnValue('Jane');

      await service.promoteToWorker(
        'member-1',
        { departmentId: 'dept-2' } as any,
        'actor-1',
      );

      // No new profile created — the existing (now-reactivated) one is reused.
      expect(mockWorkerProfileRepo.create).not.toHaveBeenCalled();
      expect(mockTxManager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'wp-1',
          status: WorkerStatusEnum.ACTIVE,
          department,
          // profession/completedSOD/isTrainee weren't supplied this time — preserved as-is.
          profession: 'Accountant',
          completedSOD: true,
          isTrainee: true,
        }),
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'WORKER_REINSTATED',
        expect.objectContaining({ actorId: 'actor-1', targetId: 'member-1' }),
      );
    });
  });

  describe('bulkPromoteToWorker', () => {
    const department = { id: 'dept-1', name: 'Music' };
    const mockTxManager = {
      save: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    beforeEach(() => {
      mockTxManager.save.mockClear();
      mockTxManager.update.mockClear();
      mockMemberRepo.manager.transaction.mockImplementation(
        async (cb: (em: typeof mockTxManager) => Promise<void>) =>
          cb(mockTxManager),
      );
    });

    it('marks every member as failed with one reason when the department does not exist', async () => {
      mockDepartmentRepo.findOneBy.mockResolvedValue(null);

      const result = await service.bulkPromoteToWorker(
        { memberIds: ['m1', 'm2'], departmentId: 'missing-dept' } as any,
        'actor-1',
      );

      expect(result).toEqual({
        promoted: 0,
        skipped: 2,
        failures: [
          { memberId: 'm1', reason: 'Department not found' },
          { memberId: 'm2', reason: 'Department not found' },
        ],
      });
      expect(mockMemberRepo.find).not.toHaveBeenCalled();
    });

    it('promotes eligible members and skips the rest, in one batched transaction', async () => {
      mockDepartmentRepo.findOneBy.mockResolvedValue(department);
      // m1 is eligible, m2 is already a worker, m3 doesn't exist
      mockMemberRepo.find.mockResolvedValue([
        {
          id: 'm1',
          email: 'm1@test.com',
          firstname: 'Jane',
          lastname: 'Doe',
          workerProfile: null,
        },
        {
          id: 'm2',
          email: 'm2@test.com',
          firstname: 'John',
          lastname: 'Smith',
          workerProfile: { id: 'wp-existing', status: WorkerStatusEnum.ACTIVE },
        },
      ]);
      mockWorkerProfileRepo.create.mockImplementation(() => ({}));
      jest
        .spyOn(UtilityService, 'capitalizeFirstLetter')
        .mockImplementation((s: string) => s);

      const result = await service.bulkPromoteToWorker(
        { memberIds: ['m1', 'm2', 'm3'], departmentId: 'dept-1' } as any,
        'actor-1',
      );

      expect(result.promoted).toBe(1);
      expect(result.skipped).toBe(2);
      expect(result.failures).toEqual(
        expect.arrayContaining([
          {
            memberId: 'm2',
            reason: 'This member is already registered as a worker.',
          },
          { memberId: 'm3', reason: 'Member not found' },
        ]),
      );
      expect(mockTxManager.save).toHaveBeenCalledWith([
        expect.objectContaining({
          member: expect.objectContaining({ id: 'm1' }),
        }),
      ]);
      expect(mockTxManager.update).toHaveBeenCalledWith(Member, ['m1'], {
        role: MemberRoleEnum.WORKER,
      });
    });

    it('does not open a transaction when no member is eligible', async () => {
      mockDepartmentRepo.findOneBy.mockResolvedValue(department);
      mockMemberRepo.find.mockResolvedValue([]);

      const result = await service.bulkPromoteToWorker(
        { memberIds: ['m1'], departmentId: 'dept-1' } as any,
        'actor-1',
      );

      expect(result).toEqual({
        promoted: 0,
        skipped: 1,
        failures: [{ memberId: 'm1', reason: 'Member not found' }],
      });
      expect(mockMemberRepo.manager.transaction).not.toHaveBeenCalled();
    });
  });

  describe('revokeWorker', () => {
    it('should throw BadRequestException if member is not a worker', async () => {
      const member = {
        id: 'member-1',
        role: MemberRoleEnum.MEMBER,
        workerProfile: null,
      };
      mockMemberRepo.findOne.mockResolvedValue(member);

      await expect(service.revokeWorker('member-1', 'actor-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should deactivate the workerProfile (not delete it) and set role to MEMBER', async () => {
      const workerProfile = { id: 'wp-1', status: WorkerStatusEnum.ACTIVE };
      const member = {
        id: 'member-1',
        email: 'worker@test.com',
        role: MemberRoleEnum.WORKER,
        workerProfile,
      };
      const mockTxManager = {
        delete: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
        save: jest.fn().mockResolvedValue(undefined),
      };
      mockMemberRepo.findOne.mockResolvedValue(member);
      mockMemberRepo.manager.transaction.mockImplementation(
        async (cb: (em: typeof mockTxManager) => Promise<void>) =>
          cb(mockTxManager),
      );

      await service.revokeWorker('member-1', 'actor-1');

      expect(mockTxManager.delete).toHaveBeenCalledWith(DepartmentLead, {
        workerProfile: { id: 'wp-1' },
      });
      expect(mockTxManager.update).toHaveBeenCalledWith(
        SundaySchoolClass,
        { teacher: { id: 'member-1' } },
        { teacher: null },
      );
      expect(mockTxManager.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: WorkerStatusEnum.INACTIVE }),
      );
      expect(mockTxManager.save).toHaveBeenCalledWith(
        expect.objectContaining({ role: MemberRoleEnum.MEMBER }),
      );
    });

    it('should throw NotFoundException when member does not exist', async () => {
      mockMemberRepo.findOne.mockResolvedValue(null);

      await expect(
        service.revokeWorker('nonexistent', 'actor-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('demoteTraineeToMember', () => {
    it('should throw BadRequestException if member is not a worker', async () => {
      mockMemberRepo.findOne.mockResolvedValue({
        id: 'member-1',
        role: MemberRoleEnum.MEMBER,
        workerProfile: null,
      });

      await expect(
        service.demoteTraineeToMember('member-1', 'actor-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if worker is not a trainee', async () => {
      mockMemberRepo.findOne.mockResolvedValue({
        id: 'member-1',
        role: MemberRoleEnum.WORKER,
        workerProfile: { id: 'wp-1', isTrainee: false },
      });

      await expect(
        service.demoteTraineeToMember('member-1', 'actor-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reset role to MEMBER and keep the WorkerProfile row (status INACTIVE)', async () => {
      const workerProfile = {
        id: 'wp-1',
        isTrainee: true,
        department: { id: 'dept-1' },
      };
      const member = {
        id: 'member-1',
        email: 'trainee@test.com',
        firstname: 'Ada',
        lastname: 'Lovelace',
        role: MemberRoleEnum.WORKER,
        workerProfile,
      };
      const mockTxManager = {
        delete: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
        save: jest.fn().mockResolvedValue(undefined),
      };
      mockMemberRepo.findOne.mockResolvedValue(member);
      mockMemberRepo.manager.transaction.mockImplementation(
        async (cb: (em: typeof mockTxManager) => Promise<void>) =>
          cb(mockTxManager),
      );

      await service.demoteTraineeToMember('member-1', 'actor-1');

      expect(mockTxManager.delete).toHaveBeenCalledWith(DepartmentLead, {
        workerProfile: { id: 'wp-1' },
      });
      expect(mockTxManager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: WorkerStatusEnum.INACTIVE,
          isTrainee: false,
        }),
      );
      expect(mockTxManager.save).toHaveBeenCalledWith(
        expect.objectContaining({ role: MemberRoleEnum.MEMBER }),
      );
    });

    it('should throw NotFoundException when member does not exist', async () => {
      mockMemberRepo.findOne.mockResolvedValue(null);

      await expect(
        service.demoteTraineeToMember('nonexistent', 'actor-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('assignClergy', () => {
    it('should throw ConflictException if member is already clergy', async () => {
      mockMemberRepo.findOne.mockResolvedValue({
        id: 'member-1',
        clergy: { id: 'clergy-1', title: { id: 'title-assoc' } },
      });

      await expect(
        service.assignClergy(
          'member-1',
          { clergyTitleId: 'title-lead' },
          'actor-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException for an unknown clergyTitleId', async () => {
      mockMemberRepo.findOne.mockResolvedValue({
        id: 'member-1',
        clergy: null,
      });
      mockClergyTitleRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.assignClergy(
          'member-1',
          { clergyTitleId: 'nonexistent' },
          'actor-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create a Clergy record for a member with none', async () => {
      const member = { id: 'member-1', email: 'm@test.com', clergy: null };
      const title = { id: 'title-lead', name: 'Lead Pastor' };
      mockMemberRepo.findOne.mockResolvedValue(member);
      mockClergyTitleRepo.findOneBy.mockResolvedValue(title);
      mockClergyRepo.create.mockReturnValue({ member, title });
      mockClergyRepo.save.mockResolvedValue({});

      await service.assignClergy(
        'member-1',
        { clergyTitleId: 'title-lead' },
        'actor-1',
      );

      expect(mockClergyRepo.create).toHaveBeenCalledWith({
        member,
        title,
      });
      expect(mockClergyRepo.save).toHaveBeenCalled();
    });
  });

  describe('updateClergyTitle', () => {
    it('should throw NotFoundException if member is not clergy', async () => {
      mockMemberRepo.findOne.mockResolvedValue({
        id: 'member-1',
        clergy: null,
      });

      await expect(
        service.updateClergyTitle(
          'member-1',
          { clergyTitleId: 'title-parish' },
          'actor-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for an unknown clergyTitleId', async () => {
      const clergy = { id: 'clergy-1', title: { id: 'title-assoc' } };
      mockMemberRepo.findOne.mockResolvedValue({ id: 'member-1', clergy });
      mockClergyTitleRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.updateClergyTitle(
          'member-1',
          { clergyTitleId: 'nonexistent' },
          'actor-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update the title on the existing Clergy record', async () => {
      const clergy = { id: 'clergy-1', title: { id: 'title-assoc' } };
      const newTitle = { id: 'title-parish', name: 'Parish Pastor' };
      mockMemberRepo.findOne.mockResolvedValue({ id: 'member-1', clergy });
      mockClergyTitleRepo.findOneBy.mockResolvedValue(newTitle);
      mockClergyRepo.save.mockResolvedValue({});

      await service.updateClergyTitle(
        'member-1',
        { clergyTitleId: 'title-parish' },
        'actor-1',
      );

      expect(mockClergyRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ title: newTitle }),
      );
    });
  });

  describe('removeClergy', () => {
    it('should throw NotFoundException if member is not clergy', async () => {
      mockMemberRepo.findOne.mockResolvedValue({
        id: 'member-1',
        clergy: null,
      });

      await expect(service.removeClergy('member-1', 'actor-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should remove the existing Clergy record', async () => {
      const clergy = { id: 'clergy-1', title: { id: 'title-lead' } };
      mockMemberRepo.findOne.mockResolvedValue({ id: 'member-1', clergy });

      await service.removeClergy('member-1', 'actor-1');

      expect(mockClergyRepo.remove).toHaveBeenCalledWith(clergy);
    });
  });

  describe('setClergyReviewAccess', () => {
    it('should throw NotFoundException if member is not clergy', async () => {
      mockMemberRepo.findOne.mockResolvedValue({
        id: 'member-1',
        clergy: null,
      });

      await expect(
        service.setClergyReviewAccess(
          'member-1',
          { canReviewFeedback: true },
          'actor-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should set canReviewFeedback on the existing Clergy record', async () => {
      const clergy = {
        id: 'clergy-1',
        title: { id: 'title-lead' },
        canReviewFeedback: false,
      };
      mockMemberRepo.findOne.mockResolvedValue({ id: 'member-1', clergy });
      mockClergyRepo.save.mockResolvedValue({});

      await service.setClergyReviewAccess(
        'member-1',
        { canReviewFeedback: true },
        'actor-1',
      );

      expect(mockClergyRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ canReviewFeedback: true }),
      );
    });
  });

  describe('changeStatus', () => {
    it('should throw BadRequestException if status is unchanged', async () => {
      const member = { id: 'member-1', status: MemberStatusEnum.ACTIVE };
      mockMemberRepo.findOne.mockResolvedValue(member);

      await expect(
        service.changeStatus('member-1', MemberStatusEnum.ACTIVE, 'actor-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should update member status when different', async () => {
      const member = { id: 'member-1', status: MemberStatusEnum.ACTIVE };
      mockMemberRepo.findOne.mockResolvedValue(member);
      mockMemberRepo.save.mockResolvedValue({
        ...member,
        status: MemberStatusEnum.INACTIVE,
      });

      await service.changeStatus(
        'member-1',
        MemberStatusEnum.INACTIVE,
        'actor-1',
      );

      expect(mockMemberRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: MemberStatusEnum.INACTIVE }),
      );
    });

    it('should throw NotFoundException when member not found for status change', async () => {
      mockMemberRepo.findOne.mockResolvedValue(null);

      await expect(
        service.changeStatus(
          'nonexistent',
          MemberStatusEnum.INACTIVE,
          'actor-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('changePassword', () => {
    it('should throw BadRequestException if old password is wrong', async () => {
      const member = { id: 'member-1', password: 'hashed_current' };
      mockCredentialsQb(member);
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(false);

      await expect(
        service.changePassword('member-1', {
          oldPassword: 'wrong_pass',
          newPassword: 'new_pass',
          confirmPassword: 'new_pass',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if confirm password does not match new password', async () => {
      const member = { id: 'member-1', password: 'hashed_current' };
      mockCredentialsQb(member);
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(true);

      await expect(
        service.changePassword('member-1', {
          oldPassword: 'current_pass',
          newPassword: 'new_pass',
          confirmPassword: 'different_pass',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should update password on success', async () => {
      const member = {
        id: 'member-1',
        password: 'hashed_current',
        changedPassword: false,
      };
      mockCredentialsQb(member);
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(true);
      jest
        .spyOn(UtilityService, 'hashValue')
        .mockResolvedValue('hashed_new_pass');
      mockMemberRepo.save.mockResolvedValue({
        ...member,
        password: 'hashed_new_pass',
        changedPassword: true,
      });

      const result = await service.changePassword('member-1', {
        oldPassword: 'current_pass',
        newPassword: 'new_pass',
        confirmPassword: 'new_pass',
      });

      expect(mockMemberRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          password: 'hashed_new_pass',
          changedPassword: true,
        }),
      );
      expect(result).toBe('Password changed successfully');
    });
  });

  describe('updateMyProfile', () => {
    it('should apply only the provided fields and save', async () => {
      const member = {
        id: 'member-1',
        firstname: 'Old',
        lastname: 'Name',
        email: 'member@test.com',
        gender: null,
      };
      mockMemberRepo.findOne.mockResolvedValue(member);
      mockMemberRepo.save.mockImplementation((m) => Promise.resolve(m));

      const result = await service.updateMyProfile('member-1', {
        firstname: 'New',
      } as any);

      expect(result.firstname).toBe('New');
      expect(result.lastname).toBe('Name');
      expect(mockMemberRepo.save).toHaveBeenCalled();
    });
  });

  describe('updateMyPhoto', () => {
    it('should upload the file, save the returned url/publicId, and not delete anything when no previous photo existed', async () => {
      const member = {
        id: 'member-1',
        email: 'member@test.com',
        photoUrl: null,
        photoPublicId: null,
      };
      mockMemberRepo.findOne.mockResolvedValue(member);
      mockMemberRepo.save.mockImplementation((m) => Promise.resolve(m));
      const file = {
        buffer: Buffer.from('img'),
        mimetype: 'image/png',
      } as Express.Multer.File;

      const result = await service.updateMyPhoto('member-1', file);

      expect(mockCloudinaryService.uploadBuffer).toHaveBeenCalledWith(
        file.buffer,
        'profile-pictures',
        undefined,
        file.mimetype,
      );
      expect(result.photoUrl).toBe(
        'https://res.cloudinary.com/test/image/upload/v1/profile-pictures/photo.jpg',
      );
      expect(mockCloudinaryService.deleteByPublicId).not.toHaveBeenCalled();
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'MEMBER_PHOTO_UPDATED',
        expect.objectContaining({ actorId: 'member-1', targetId: 'member-1' }),
      );
    });

    it('should delete the previous photo by publicId after saving the new one', async () => {
      const member = {
        id: 'member-1',
        email: 'member@test.com',
        photoUrl: 'https://old.example.com/old.jpg',
        photoPublicId: 'profile-pictures/old',
      };
      mockMemberRepo.findOne.mockResolvedValue(member);
      mockMemberRepo.save.mockImplementation((m) => Promise.resolve(m));
      const file = {
        buffer: Buffer.from('img'),
        mimetype: 'image/png',
      } as Express.Multer.File;

      await service.updateMyPhoto('member-1', file);

      expect(mockCloudinaryService.deleteByPublicId).toHaveBeenCalledWith(
        'profile-pictures/old',
        'image',
      );
    });
  });

  describe('removeMyPhoto', () => {
    it('should clear both photo columns and delete the Cloudinary asset', async () => {
      const member = {
        id: 'member-1',
        email: 'member@test.com',
        photoUrl: 'https://old.example.com/old.jpg',
        photoPublicId: 'profile-pictures/old',
      };
      mockMemberRepo.findOne.mockResolvedValue(member);
      mockMemberRepo.save.mockImplementation((m) => Promise.resolve(m));

      const result = await service.removeMyPhoto('member-1');

      expect(result.photoUrl).toBeNull();
      expect(result.photoPublicId).toBeNull();
      expect(mockCloudinaryService.deleteByPublicId).toHaveBeenCalledWith(
        'profile-pictures/old',
        'image',
      );
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'MEMBER_PHOTO_REMOVED',
        expect.objectContaining({
          actorId: 'member-1',
          targetId: 'member-1',
          metadata: { self: true },
        }),
      );
    });
  });

  describe('removeMemberPhoto', () => {
    it('should clear the photo with the admin as the audit actor', async () => {
      const member = {
        id: 'member-1',
        email: 'member@test.com',
        photoUrl: 'https://old.example.com/old.jpg',
        photoPublicId: 'profile-pictures/old',
      };
      mockMemberRepo.findOne.mockResolvedValue(member);
      mockMemberRepo.save.mockImplementation((m) => Promise.resolve(m));

      const result = await service.removeMemberPhoto('member-1', 'admin-1');

      expect(result.photoUrl).toBeNull();
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'MEMBER_PHOTO_REMOVED',
        expect.objectContaining({
          actorId: 'admin-1',
          targetId: 'member-1',
          metadata: { self: false },
        }),
      );
    });
  });

  describe('updateEmail', () => {
    it('should update the member email directly', async () => {
      mockMemberRepo.update.mockResolvedValue({ affected: 1 });

      await service.updateEmail('member-1', 'new@test.com');

      expect(mockMemberRepo.update).toHaveBeenCalledWith('member-1', {
        email: 'new@test.com',
      });
    });
  });

  describe('searchActiveMembersLite', () => {
    it('returns an empty array without querying when the query is blank', async () => {
      const result = await service.searchActiveMembersLite('   ');

      expect(result).toEqual([]);
      expect(mockMemberRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('searches active members by first/last name and returns minimal fields only', async () => {
      const found = [
        {
          id: 'm1',
          firstname: 'Ada',
          lastname: 'Lovelace',
          role: MemberRoleEnum.MEMBER,
        },
      ];
      const qb = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(found),
      };
      mockMemberRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.searchActiveMembersLite('ada');

      expect(qb.select).toHaveBeenCalledWith([
        'member.id',
        'member.firstname',
        'member.lastname',
        'member.role',
      ]);
      expect(qb.where).toHaveBeenCalledWith('member.status = :status', {
        status: MemberStatusEnum.ACTIVE,
      });
      expect(qb.take).toHaveBeenCalledWith(10);
      expect(result).toEqual(found);
    });
  });

  describe('getById', () => {
    it('should throw NotFoundException when member not found', async () => {
      mockMemberRepo.findOne.mockResolvedValue(null);

      await expect(service.getById('nonexistent-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return member when found', async () => {
      const member = {
        id: 'member-1',
        email: 'test@test.com',
        role: MemberRoleEnum.MEMBER,
        requiresPasswordChange: false,
        surface: SessionSurface.MEMBER,
      };
      mockMemberRepo.findOne.mockResolvedValue(member);

      const result = await service.getById('member-1');

      expect(result).toEqual(member);
      expect(mockMemberRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'member-1' },
        relations: [],
      });
    });

    it('should pass relations to findOne', async () => {
      const member = { id: 'member-1', workerProfile: { id: 'wp-1' } };
      mockMemberRepo.findOne.mockResolvedValue(member);

      await service.getById('member-1', ['workerProfile']);

      expect(mockMemberRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'member-1' },
        relations: ['workerProfile'],
      });
    });
  });

  describe('purgeDevice', () => {
    it('clears deviceId, logs out all surfaces, and unsubscribes push', async () => {
      mockMemberRepo.update.mockResolvedValue(undefined);
      mockSessionService.updateLogout.mockResolvedValue(undefined);

      await service.purgeDevice('member-1', 'admin-1');

      expect(mockMemberRepo.update).toHaveBeenCalledWith('member-1', {
        deviceId: null,
      });
      expect(mockSessionService.updateLogout).toHaveBeenCalledWith(
        'member-1',
        SessionSurface.MEMBER,
      );
      expect(mockSessionService.updateLogout).toHaveBeenCalledWith(
        'member-1',
        SessionSurface.ADMIN,
      );
      expect(mockPushService.unsubscribe).toHaveBeenCalledWith('member-1');
    });
  });
});
