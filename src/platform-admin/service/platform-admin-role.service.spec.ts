import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PlatformAdminRoleService } from './platform-admin-role.service';
import { PlatformAdminRole } from '../entity/platform-admin-role.entity';

const mockRoleRepo = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  findOne: jest.fn(),
  existsBy: jest.fn(),
  create: jest.fn((v) => v),
  save: jest.fn((v) => Promise.resolve({ id: 'role-1', ...v })),
  remove: jest.fn(),
};

describe('PlatformAdminRoleService', () => {
  let service: PlatformAdminRoleService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformAdminRoleService,
        {
          provide: getRepositoryToken(PlatformAdminRole),
          useValue: mockRoleRepo,
        },
      ],
    }).compile();
    service = module.get(PlatformAdminRoleService);
  });

  describe('create', () => {
    it('creates a role with the given permissions', async () => {
      mockRoleRepo.existsBy.mockResolvedValue(false);
      const result = await service.create({
        name: 'Support',
        permissions: ['tenants:read' as any],
      });
      expect(result.name).toBe('Support');
      expect(mockRoleRepo.save).toHaveBeenCalled();
    });

    it('rejects a duplicate role name', async () => {
      mockRoleRepo.existsBy.mockResolvedValue(true);
      await expect(
        service.create({ name: 'SuperAdmin', permissions: [] }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('delete', () => {
    it('blocks deletion when the role has active admins', async () => {
      mockRoleRepo.findOne.mockResolvedValue({
        id: 'role-1',
        name: 'Support',
        admins: [{ isActive: true }],
      });
      await expect(service.delete('role-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockRoleRepo.remove).not.toHaveBeenCalled();
    });

    it('allows deletion when every assigned admin is inactive', async () => {
      mockRoleRepo.findOne.mockResolvedValue({
        id: 'role-1',
        name: 'Support',
        admins: [{ isActive: false }],
      });
      await service.delete('role-1');
      expect(mockRoleRepo.remove).toHaveBeenCalled();
    });

    it('throws NotFoundException for a missing role', async () => {
      mockRoleRepo.findOne.mockResolvedValue(null);
      await expect(service.delete('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findOrCreateSuperAdmin', () => {
    it('returns the existing SuperAdmin role if present', async () => {
      mockRoleRepo.findOneBy.mockResolvedValue({
        id: 'role-1',
        name: 'SuperAdmin',
      });
      const result = await service.findOrCreateSuperAdmin();
      expect(result.id).toBe('role-1');
      expect(mockRoleRepo.save).not.toHaveBeenCalled();
    });

    it('seeds a SuperAdmin role with every permission if none exists', async () => {
      mockRoleRepo.findOneBy.mockResolvedValue(null);
      const result = await service.findOrCreateSuperAdmin();
      expect(result.name).toBe('SuperAdmin');
      expect(mockRoleRepo.save).toHaveBeenCalled();
      const saved = mockRoleRepo.save.mock.calls[0][0];
      expect(saved.permissions.length).toBeGreaterThan(0);
    });
  });
});
