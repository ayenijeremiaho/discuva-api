import { Admin } from '../entity/admin.entity';
import { mockAdminAccess } from '../testing/admin-access.mock';
import { AdminAccessService } from './admin-access.service';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AdminRoleService } from './admin-role.service';
import { AdminRole } from '../entity/admin-role.entity';
import { AdminPermission } from '../enum/admin-permission.enum';
import { AuditLogService } from '../../utility/service/audit-log.service';

const mockAdmins = { findOne: jest.fn(), existsBy: jest.fn() };

const mockAdminRoleRepo = {
  existsBy: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  find: jest.fn(),
  remove: jest.fn(),
};

const mockAuditLogService = { log: jest.fn() };

const mockRole: AdminRole = {
  id: 'role-1',
  name: 'Editor',
  description: 'Can edit content',
  permissions: [AdminPermission.MEMBERS_READ],
  admins: [],
} as any;

describe('AdminRoleService', () => {
  let service: AdminRoleService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: getRepositoryToken(Admin),
          useValue: mockAdmins,
        },
        { provide: AdminAccessService, useValue: mockAdminAccess },
        AdminRoleService,
        { provide: getRepositoryToken(AdminRole), useValue: mockAdminRoleRepo },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();
    service = module.get<AdminRoleService>(AdminRoleService);
  });

  describe('create', () => {
    it('should throw ConflictException if name already exists', async () => {
      mockAdminRoleRepo.existsBy.mockResolvedValue(true);
      await expect(
        service.create({ name: 'Editor', permissions: [] }, 'actor-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('should create and return a new admin role', async () => {
      mockAdminRoleRepo.existsBy.mockResolvedValue(false);
      mockAdminRoleRepo.create.mockReturnValue(mockRole);
      mockAdminRoleRepo.save.mockResolvedValue(mockRole);

      const result = await service.create(
        {
          name: 'Editor',
          permissions: [AdminPermission.MEMBERS_READ],
        },
        'actor-1',
      );
      expect(result).toEqual(mockRole);
      expect(mockAdminRoleRepo.save).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should throw NotFoundException if role not found', async () => {
      mockAdminRoleRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.update('nonexistent', {}, 'actor-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if new name is taken', async () => {
      mockAdminRoleRepo.findOneBy.mockResolvedValue({ ...mockRole });
      mockAdminRoleRepo.existsBy.mockResolvedValue(true);
      await expect(
        service.update('role-1', { name: 'TakenName' }, 'actor-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('should update and return the role', async () => {
      mockAdminRoleRepo.findOneBy.mockResolvedValue({ ...mockRole });
      mockAdminRoleRepo.existsBy.mockResolvedValue(false);
      const updated = { ...mockRole, name: 'NewName' };
      mockAdminRoleRepo.save.mockResolvedValue(updated);
      const result = await service.update(
        'role-1',
        { name: 'NewName' },
        'actor-1',
      );
      expect(result.name).toBe('NewName');
    });
  });

  describe('delete', () => {
    it('should throw NotFoundException if role not found', async () => {
      mockAdminRoleRepo.findOne.mockResolvedValue(null);
      await expect(service.delete('nonexistent', 'actor-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if role has active admins', async () => {
      mockAdminRoleRepo.findOne.mockResolvedValue({
        ...mockRole,
        admins: [{ isActive: true }],
      });
      await expect(service.delete('role-1', 'actor-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should delete a role with no active admins', async () => {
      mockAdminRoleRepo.findOne.mockResolvedValue({ ...mockRole, admins: [] });
      mockAdminRoleRepo.remove.mockResolvedValue(undefined);
      await expect(
        service.delete('role-1', 'actor-1'),
      ).resolves.toBeUndefined();
      expect(mockAdminRoleRepo.remove).toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('should throw NotFoundException if role not found', async () => {
      mockAdminRoleRepo.findOneBy.mockResolvedValue(null);
      await expect(service.getById('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return the role', async () => {
      mockAdminRoleRepo.findOneBy.mockResolvedValue(mockRole);
      const result = await service.getById('role-1');
      expect(result).toEqual(mockRole);
    });
  });

  describe('getAll', () => {
    it('should return all roles', async () => {
      mockAdminRoleRepo.find.mockResolvedValue([mockRole]);
      const result = await service.getAll();
      expect(result).toHaveLength(1);
    });
  });
  it('does not let a non-owner change an owner through a shared role', async () => {
    mockAdminAccess.isOn.mockResolvedValueOnce(true);
    mockAdmins.findOne.mockResolvedValueOnce({
      isOwner: false,
      isActive: true,
    });
    mockAdmins.existsBy.mockResolvedValueOnce(true);
    mockAdminRoleRepo.findOneBy.mockResolvedValueOnce(mockRole);
    await expect(
      service.update('role-1', { permissions: [] }, 'actor'),
    ).rejects.toThrow('account owner');
    expect(mockAdminRoleRepo.save).not.toHaveBeenCalled();
  });
});
