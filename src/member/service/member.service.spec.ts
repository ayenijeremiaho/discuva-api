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

const mockMemberRepo = {
  findOne: jest.fn(),
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

const mockUtilityService = {
  sendEmailWithTemplate: jest.fn(),
  sendEmail: jest.fn(),
};

const mockAuditLogService = { log: jest.fn() };

const mockSessionService = { updateLogout: jest.fn() };

const mockConfigService = { get: jest.fn() };

const mockPushService = { unsubscribe: jest.fn() };

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemberService,
        { provide: getRepositoryToken(Member), useValue: mockMemberRepo },
        {
          provide: getRepositoryToken(WorkerProfile),
          useValue: mockWorkerProfileRepo,
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

  describe('promoteToWorker', () => {
    it('should throw BadRequestException if member is already a worker', async () => {
      const memberWithProfile = {
        id: 'member-1',
        role: MemberRoleEnum.WORKER,
        workerProfile: { id: 'wp-1' },
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

      mockMemberRepo.findOne
        .mockResolvedValueOnce(member)
        .mockResolvedValueOnce(updatedMember);
      mockDepartmentRepo.findOneBy.mockResolvedValue(department);
      mockWorkerProfileRepo.create.mockReturnValue(workerProfile);
      mockWorkerProfileRepo.save.mockResolvedValue(workerProfile);
      mockMemberRepo.update.mockResolvedValue({ affected: 1 });
      jest
        .spyOn(UtilityService, 'capitalizeFirstLetter')
        .mockReturnValue('Jane');

      const result = await service.promoteToWorker(
        'member-1',
        { departmentId: 'dept-1' } as any,
        'actor-1',
      );

      expect(mockWorkerProfileRepo.save).toHaveBeenCalled();
      expect(mockMemberRepo.update).toHaveBeenCalledWith('member-1', {
        role: MemberRoleEnum.WORKER,
      });
      expect(result.role).toBe(MemberRoleEnum.WORKER);
    });
  });

  describe('bulkPromoteToWorker', () => {
    it('should count promoted and skipped correctly', async () => {
      const promoted = { id: 'm1', role: MemberRoleEnum.WORKER } as any;
      jest
        .spyOn(service, 'promoteToWorker')
        .mockResolvedValueOnce(promoted)
        .mockRejectedValueOnce(new NotFoundException('Member not found'))
        .mockResolvedValueOnce({ ...promoted, id: 'm3' });

      const result = await service.bulkPromoteToWorker(
        { memberIds: ['m1', 'm2', 'm3'], departmentId: 'dept-1' } as any,
        'actor-1',
      );

      expect(result.promoted).toBe(2);
      expect(result.skipped).toBe(1);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].memberId).toBe('m2');
      expect(result.failures[0].reason).toBe('Member not found');
    });

    it('should include reason in failures when promoteToWorker throws', async () => {
      jest
        .spyOn(service, 'promoteToWorker')
        .mockRejectedValueOnce(new BadRequestException('Already a worker'));

      const result = await service.bulkPromoteToWorker(
        { memberIds: ['bad-id'], departmentId: 'dept-1' } as any,
        'actor-1',
      );

      expect(result.skipped).toBe(1);
      expect(result.failures[0]).toMatchObject({
        memberId: 'bad-id',
        reason: 'Already a worker',
      });
    });

    it('should return empty failures array on full success', async () => {
      const promoted = { id: 'm1', role: MemberRoleEnum.WORKER } as any;
      jest.spyOn(service, 'promoteToWorker').mockResolvedValue(promoted);

      const result = await service.bulkPromoteToWorker(
        { memberIds: ['m1'], departmentId: 'dept-1' } as any,
        'actor-1',
      );

      expect(result.promoted).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.failures).toEqual([]);
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

    it('should remove workerProfile and set role to MEMBER', async () => {
      const workerProfile = { id: 'wp-1' };
      const member = {
        id: 'member-1',
        email: 'worker@test.com',
        role: MemberRoleEnum.WORKER,
        workerProfile,
      };
      const mockTxManager = {
        delete: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
        remove: jest.fn().mockResolvedValue(undefined),
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
      expect(mockTxManager.remove).toHaveBeenCalledWith(workerProfile);
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

      expect(mockMemberRepo.update).toHaveBeenCalledWith('member-1', { deviceId: null });
      expect(mockSessionService.updateLogout).toHaveBeenCalledWith('member-1', SessionSurface.MEMBER);
      expect(mockSessionService.updateLogout).toHaveBeenCalledWith('member-1', SessionSurface.ADMIN);
      expect(mockPushService.unsubscribe).toHaveBeenCalledWith('member-1');
    });
  });
});
