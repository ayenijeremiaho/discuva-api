import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { IsNull } from 'typeorm';
import * as argon2 from 'argon2';
import { PlatformAdminAuthService } from './platform-admin-auth.service';
import { PlatformAdmin } from '../entity/platform-admin.entity';
import { PlatformAdminPasswordResetOtp } from '../entity/platform-admin-password-reset-otp.entity';
import { UtilityService } from '../../utility/service/utility.service';

jest.mock('argon2');

const mockPlatformAdminRepo = {
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  createQueryBuilder: jest.fn(),
  save: jest.fn((v) => Promise.resolve(v)),
};
const mockOtpRepo = {
  delete: jest.fn(),
  create: jest.fn((v) => v),
  save: jest.fn((v) => Promise.resolve({ id: 'otp-1', ...v })),
  findOne: jest.fn(),
};
const mockJwtService = { signAsync: jest.fn().mockResolvedValue('signed-jwt') };
const mockUtilityService = { sendEmailWithTemplate: jest.fn() };
const mockConfigService = { get: jest.fn().mockReturnValue('Discuva') };

describe('PlatformAdminAuthService', () => {
  let service: PlatformAdminAuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformAdminAuthService,
        {
          provide: getRepositoryToken(PlatformAdmin),
          useValue: mockPlatformAdminRepo,
        },
        {
          provide: getRepositoryToken(PlatformAdminPasswordResetOtp),
          useValue: mockOtpRepo,
        },
        { provide: JwtService, useValue: mockJwtService },
        { provide: UtilityService, useValue: mockUtilityService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    service = module.get(PlatformAdminAuthService);
  });

  describe('validateById', () => {
    it('returns the admin auth shape including permissions from their role', async () => {
      mockPlatformAdminRepo.findOne.mockResolvedValue({
        id: 'admin-1',
        email: 'admin@example.com',
        isActive: true,
        platformAdminRole: { permissions: ['tenants:read', 'tenants:write'] },
      });

      const result = await service.validateById('admin-1');

      expect(result).toEqual({
        id: 'admin-1',
        email: 'admin@example.com',
        role: 'platform_admin',
        permissions: ['tenants:read', 'tenants:write'],
      });
    });

    it('throws UnauthorizedException when no active admin matches', async () => {
      mockPlatformAdminRepo.findOne.mockResolvedValue(null);
      await expect(service.validateById('missing')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('returns an empty permissions array if the role relation is somehow missing', async () => {
      mockPlatformAdminRepo.findOne.mockResolvedValue({
        id: 'admin-1',
        email: 'admin@example.com',
        isActive: true,
        platformAdminRole: null,
      });
      const result = await service.validateById('admin-1');
      expect(result.permissions).toEqual([]);
    });
  });

  describe('login', () => {
    it('issues a token for valid credentials and reports requiresPasswordChange', async () => {
      const qb = {
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          id: 'admin-1',
          passwordHash: 'hashed',
          changedPassword: false,
        }),
      };
      mockPlatformAdminRepo.createQueryBuilder.mockReturnValue(qb);
      (argon2.verify as jest.Mock).mockResolvedValue(true);

      const result = await service.login('admin@example.com', 'password123');

      expect(result).toEqual({
        accessToken: 'signed-jwt',
        requiresPasswordChange: true,
      });
      expect(mockJwtService.signAsync).toHaveBeenCalledWith({
        sub: 'admin-1',
        role: 'platform_admin',
      });
    });

    it('reports requiresPasswordChange false once the admin has set a real password', async () => {
      const qb = {
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          id: 'admin-1',
          passwordHash: 'hashed',
          changedPassword: true,
        }),
      };
      mockPlatformAdminRepo.createQueryBuilder.mockReturnValue(qb);
      (argon2.verify as jest.Mock).mockResolvedValue(true);

      const result = await service.login('admin@example.com', 'password123');
      expect(result.requiresPasswordChange).toBe(false);
    });

    it('throws UnauthorizedException for a wrong password', async () => {
      const qb = {
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          id: 'admin-1',
          passwordHash: 'hashed',
        }),
      };
      mockPlatformAdminRepo.createQueryBuilder.mockReturnValue(qb);
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(service.login('admin@example.com', 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when no admin matches the email', async () => {
      const qb = {
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      mockPlatformAdminRepo.createQueryBuilder.mockReturnValue(qb);

      await expect(
        service.login('nobody@example.com', 'password123'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('forgotPassword', () => {
    it('clears prior unused OTPs, seeds a new one, and emails it', async () => {
      mockPlatformAdminRepo.findOneBy.mockResolvedValue({
        id: 'admin-1',
        email: 'admin@example.com',
      });
      (argon2.hash as jest.Mock).mockResolvedValue('hashed-otp');

      await service.forgotPassword('Admin@Example.com');

      expect(mockOtpRepo.delete).toHaveBeenCalledWith({
        platformAdminId: 'admin-1',
        usedAt: IsNull(),
      });
      const otpSaveCall = mockOtpRepo.save.mock.calls[0][0];
      expect(otpSaveCall.platformAdminId).toBe('admin-1');
      expect(otpSaveCall.otpHash).toEqual(expect.any(String));
      expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
        'admin@example.com',
        expect.any(String),
        'forgot-password-otp',
        expect.objectContaining({ otp: expect.stringMatching(/^\d{6}$/) }),
      );
    });

    it('does nothing for an unknown email — silent, no account-existence leak', async () => {
      mockPlatformAdminRepo.findOneBy.mockResolvedValue(null);

      await service.forgotPassword('nobody@example.com');

      expect(mockOtpRepo.delete).not.toHaveBeenCalled();
      expect(mockUtilityService.sendEmailWithTemplate).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    const dto = {
      email: 'admin@example.com',
      otp: '123456',
      newPassword: 'NewSecure1!',
    };

    it('verifies the OTP, updates the password, and sets changedPassword true', async () => {
      mockPlatformAdminRepo.findOneBy.mockResolvedValue({
        id: 'admin-1',
        email: 'admin@example.com',
        changedPassword: false,
      });
      mockOtpRepo.findOne.mockResolvedValue({
        id: 'otp-1',
        otpHash: 'hashed-otp',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      });
      jest
        .spyOn(UtilityService, 'verifyHashedValue')
        .mockResolvedValue(true as never);

      await service.resetPassword(dto as any);

      expect(mockOtpRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ usedAt: expect.any(Date) }),
      );
      expect(mockPlatformAdminRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ changedPassword: true }),
      );
    });

    it('rejects an expired OTP', async () => {
      mockPlatformAdminRepo.findOneBy.mockResolvedValue({
        id: 'admin-1',
        email: 'admin@example.com',
      });
      mockOtpRepo.findOne.mockResolvedValue({
        id: 'otp-1',
        otpHash: 'hashed-otp',
        expiresAt: new Date(Date.now() - 1000),
        usedAt: null,
      });

      await expect(service.resetPassword(dto as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an unknown email', async () => {
      mockPlatformAdminRepo.findOneBy.mockResolvedValue(null);
      await expect(service.resetPassword(dto as any)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
