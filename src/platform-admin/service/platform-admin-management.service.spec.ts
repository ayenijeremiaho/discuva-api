import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlatformAdminManagementService } from './platform-admin-management.service';
import { PlatformAdminRoleService } from './platform-admin-role.service';
import { PlatformAdmin } from '../entity/platform-admin.entity';
import { PlatformAdminPasswordResetOtp } from '../entity/platform-admin-password-reset-otp.entity';
import { UtilityService } from '../../utility/service/utility.service';

const mockPlatformAdminRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  existsBy: jest.fn(),
  create: jest.fn((v) => v),
  save: jest.fn((v) => Promise.resolve({ id: 'admin-2', ...v })),
};
const mockOtpRepo = {
  create: jest.fn((v) => v),
  save: jest.fn((v) => Promise.resolve({ id: 'otp-1', ...v })),
};
const mockRoleService = { getById: jest.fn() };
const mockUtilityService = { sendEmailWithTemplate: jest.fn() };
const mockConfigService = {
  get: jest.fn((key: string) =>
    key === 'PLATFORM_LOGIN_URL' ? 'https://platform.example.com' : 'Discuva',
  ),
};

describe('PlatformAdminManagementService', () => {
  let service: PlatformAdminManagementService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformAdminManagementService,
        {
          provide: getRepositoryToken(PlatformAdmin),
          useValue: mockPlatformAdminRepo,
        },
        {
          provide: getRepositoryToken(PlatformAdminPasswordResetOtp),
          useValue: mockOtpRepo,
        },
        { provide: PlatformAdminRoleService, useValue: mockRoleService },
        { provide: UtilityService, useValue: mockUtilityService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    service = module.get(PlatformAdminManagementService);
  });

  describe('create', () => {
    it('generates a random password, seeds a welcome OTP, and emails a set-password link — no password taken from the caller', async () => {
      mockPlatformAdminRepo.existsBy.mockResolvedValue(false);
      mockRoleService.getById.mockResolvedValue({
        id: 'role-1',
        name: 'Support',
      });
      mockPlatformAdminRepo.findOne.mockResolvedValue({
        id: 'admin-2',
        email: 'new@example.com',
        platformAdminRole: { id: 'role-1', name: 'Support' },
      });

      const result = await service.create({
        email: 'New@Example.com',
        platformAdminRoleId: 'role-1',
      } as any);

      expect(mockPlatformAdminRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'new@example.com',
          passwordHash: expect.any(String),
          changedPassword: false,
        }),
      );

      const otpSaveCall = mockOtpRepo.save.mock.calls[0][0];
      expect(otpSaveCall.platformAdminId).toBe('admin-2');
      expect(otpSaveCall.otpHash).toEqual(expect.any(String));
      expect(otpSaveCall.expiresAt.getTime()).toBeGreaterThan(Date.now());

      expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
        'new@example.com',
        expect.stringContaining('platform admin'),
        'platform-admin-welcome',
        expect.objectContaining({
          email: 'new@example.com',
          role_name: 'Support',
          otp: expect.stringMatching(/^\d{6}$/),
          set_password_url: expect.stringContaining(
            'https://platform.example.com/set-password?email=new%40example.com',
          ),
        }),
      );

      expect(result.email).toBe('new@example.com');
    });

    it('rejects a duplicate email', async () => {
      mockPlatformAdminRepo.existsBy.mockResolvedValue(true);
      await expect(
        service.create({
          email: 'dupe@example.com',
          platformAdminRoleId: 'role-1',
        } as any),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('blocks an admin from modifying their own record', async () => {
      await expect(
        service.update('admin-1', { isActive: false }, 'admin-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('applies role and isActive changes to a different admin', async () => {
      mockPlatformAdminRepo.findOne.mockResolvedValue({
        id: 'admin-2',
        isActive: true,
        platformAdminRole: { id: 'role-1' },
      });
      mockRoleService.getById.mockResolvedValue({
        id: 'role-2',
        name: 'Finance',
      });

      await service.update(
        'admin-2',
        { platformAdminRoleId: 'role-2', isActive: false },
        'admin-1',
      );

      expect(mockPlatformAdminRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          isActive: false,
          platformAdminRole: { id: 'role-2', name: 'Finance' },
        }),
      );
    });
  });
});
