import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminService } from './admin.service';
import { Admin } from '../entity/admin.entity';
import { AdminRoleService } from './admin-role.service';
import { MemberService } from '../../member/service/member.service';
import { AdminPermission } from '../enum/admin-permission.enum';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { UtilityService } from '../../utility/service/utility.service';

const mockAdminRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  countBy: jest.fn(),
};

const mockAdminRoleService = {
  getById: jest.fn(),
};

const mockMemberService = {
  getById: jest.fn(),
};

const mockAuditLogService = { log: jest.fn() };
const mockUtilityService = { sendEmailWithTemplate: jest.fn() };
const mockConfigService = {
  get: jest.fn().mockReturnValue('http://localhost:3000'),
};

const mockMember = {
  id: 'member-1',
  firstname: 'John',
  lastname: 'Doe',
  email: 'john@test.com',
};
const mockAdminRole = {
  id: 'role-1',
  name: 'SuperAdmin',
  permissions: Object.values(AdminPermission),
};
const mockAdmin: Admin = {
  id: 'admin-1',
  member: mockMember as any,
  adminRole: mockAdminRole as any,
  isActive: true,
} as any;

describe('AdminService', () => {
  let service: AdminService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getRepositoryToken(Admin), useValue: mockAdminRepo },
        { provide: AdminRoleService, useValue: mockAdminRoleService },
        { provide: MemberService, useValue: mockMemberService },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: UtilityService, useValue: mockUtilityService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    service = module.get<AdminService>(AdminService);
  });

  describe('grant', () => {
    it('should throw ConflictException if member already has an active admin account', async () => {
      mockMemberService.getById.mockResolvedValue(mockMember);
      mockAdminRepo.findOne.mockResolvedValue({ ...mockAdmin, isActive: true });

      await expect(
        service.grant(
          { memberId: 'member-1', adminRoleId: 'role-1' },
          'actor-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should reactivate an inactive admin account', async () => {
      const inactive = { ...mockAdmin, isActive: false };
      mockMemberService.getById.mockResolvedValue(mockMember);
      mockAdminRepo.findOne.mockResolvedValue(inactive);
      mockAdminRoleService.getById.mockResolvedValue(mockAdminRole);
      mockAdminRepo.save.mockResolvedValue({ ...inactive, isActive: true });

      const result = await service.grant(
        { memberId: 'member-1', adminRoleId: 'role-1' },
        'actor-1',
      );
      expect(result.isActive).toBe(true);
    });

    it('should create a new admin record', async () => {
      mockMemberService.getById.mockResolvedValue(mockMember);
      mockAdminRepo.findOne.mockResolvedValue(null);
      mockAdminRoleService.getById.mockResolvedValue(mockAdminRole);
      mockAdminRepo.create.mockReturnValue(mockAdmin);
      mockAdminRepo.save.mockResolvedValue(mockAdmin);

      const result = await service.grant(
        { memberId: 'member-1', adminRoleId: 'role-1' },
        'actor-1',
      );
      expect(result).toEqual(mockAdmin);
      expect(mockAdminRepo.save).toHaveBeenCalled();
    });
  });

  describe('revoke', () => {
    it('should throw NotFoundException if admin not found', async () => {
      mockAdminRepo.findOne.mockResolvedValue(null);
      await expect(service.revoke('nonexistent', 'actor-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should set isActive to false', async () => {
      mockAdminRepo.findOne.mockResolvedValue({ ...mockAdmin });
      mockAdminRepo.save.mockResolvedValue({ ...mockAdmin, isActive: false });
      await service.revoke('admin-1', 'actor-1');
      expect(mockAdminRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
      );
    });
  });

  describe('findById', () => {
    it('should throw NotFoundException if admin not found', async () => {
      mockAdminRepo.findOne.mockResolvedValue(null);
      await expect(service.findById('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return admin by id', async () => {
      mockAdminRepo.findOne.mockResolvedValue(mockAdmin);
      const result = await service.findById('admin-1');
      expect(result).toEqual(mockAdmin);
    });
  });

  describe('getMyProfile', () => {
    it('should throw NotFoundException if admin not found', async () => {
      mockAdminRepo.findOne.mockResolvedValue(null);
      await expect(service.getMyProfile('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should load member.spouse alongside member and adminRole', async () => {
      mockAdminRepo.findOne.mockResolvedValue(mockAdmin);
      await service.getMyProfile('admin-1');
      expect(mockAdminRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'admin-1' },
        relations: ['member', 'member.spouse', 'adminRole'],
      });
    });
  });

  describe('countActive', () => {
    it('should return count of active admins', async () => {
      mockAdminRepo.countBy.mockResolvedValue(3);
      const count = await service.countActive();
      expect(count).toBe(3);
    });
  });
});
