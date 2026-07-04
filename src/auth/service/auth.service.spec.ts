import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AdminService } from '../../admin/service/admin.service';
import { MemberService } from '../../member/service/member.service';
import { MemberSessionService } from '../../member/service/member-session.service';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { CacheService } from '../../utility/service/cache.service';
import { PasswordResetOtp } from '../entity/password-reset-otp.entity';
import { DeviceResetOtp } from '../entity/device-reset-otp.entity';
import { DepartmentLead } from '../../department/entity/department-lead.entity';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import refreshJwtConfig from '../../config/refresh.jwt.config';
import { SessionSurface } from '../enum/session-surface.enum';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';

const mockUtilityService = {
  sendEmailWithTemplate: jest.fn(),
  sendEmail: jest.fn(),
};

const mockAuditLogService = { log: jest.fn() };

const mockPushService = { unsubscribe: jest.fn() };

const mockOtpQb = {
  delete: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  execute: jest.fn().mockResolvedValue({ affected: 5 }),
};

const mockCacheService = {
  key: jest.fn().mockImplementation((ns: string, id: string) => `${ns}:${id}`),
  get: jest.fn().mockResolvedValue(0),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(1),
  incr: jest.fn().mockResolvedValue(1),
  acquireLock: jest.fn().mockResolvedValue(true),
  releaseLock: jest.fn(),
};

const mockOtpRepository = {
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  delete: jest.fn(),
  createQueryBuilder: jest.fn().mockReturnValue(mockOtpQb),
};

const mockDeviceResetOtpRepository = {
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  delete: jest.fn(),
};

const mockDepartmentLeadRepo = { exists: jest.fn().mockResolvedValue(false) };

const mockAdminService = {
  findByMemberId: jest.fn(),
};

const mockMemberService = {
  findByEmail: jest.fn(),
  getById: jest.fn().mockResolvedValue({
    id: 'member-1',
    firstname: 'Test',
    email: 'test@test.com',
    deviceId: null,
  }),
  signup: jest.fn(),
  changePassword: jest.fn(),
  setDeviceId: jest.fn().mockResolvedValue(undefined),
};

const mockSessionService = {
  updateLogout: jest.fn(),
  updateLogin: jest.fn(),
  getHashedRefreshToken: jest.fn(),
};

const mockJwtService = {
  signAsync: jest.fn(),
};

const mockConfigService = {
  get: jest.fn(),
};

const mockRefreshJwtConfig = {
  secret: 'refresh-secret',
  expiresIn: '7d',
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigService.get.mockImplementation(
      (_key: string, defaultValue?: string) => defaultValue,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: MemberService, useValue: mockMemberService },
        { provide: MemberSessionService, useValue: mockSessionService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: UtilityService, useValue: mockUtilityService },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: AdminService, useValue: mockAdminService },
        { provide: refreshJwtConfig.KEY, useValue: mockRefreshJwtConfig },
        {
          provide: getRepositoryToken(PasswordResetOtp),
          useValue: mockOtpRepository,
        },
        {
          provide: getRepositoryToken(DeviceResetOtp),
          useValue: mockDeviceResetOtpRepository,
        },
        {
          provide: getRepositoryToken(DepartmentLead),
          useValue: mockDepartmentLeadRepo,
        },
        { provide: PushNotificationService, useValue: mockPushService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('validateMember', () => {
    it('should throw UnauthorizedException if member not found', async () => {
      mockMemberService.findByEmail.mockResolvedValue(null);

      await expect(
        service.validateMember('unknown@test.com', 'pass'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if password is wrong', async () => {
      const member = {
        id: 'member-1',
        email: 'user@test.com',
        password: 'hashed_pass',
        status: MemberStatusEnum.ACTIVE,
        role: MemberRoleEnum.MEMBER,
      };
      mockMemberService.findByEmail.mockResolvedValue(member);
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(false);

      await expect(
        service.validateMember('user@test.com', 'wrong_pass'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if member is INACTIVE', async () => {
      const member = {
        id: 'member-1',
        email: 'inactive@test.com',
        password: 'hashed_pass',
        status: MemberStatusEnum.INACTIVE,
        role: MemberRoleEnum.MEMBER,
      };
      mockMemberService.findByEmail.mockResolvedValue(member);
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(true);

      await expect(
        service.validateMember('inactive@test.com', 'pass'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return MemberAuth with id and role on success', async () => {
      const member = {
        id: 'member-1',
        email: 'active@test.com',
        password: 'hashed_pass',
        status: MemberStatusEnum.ACTIVE,
        role: MemberRoleEnum.MEMBER,
        changedPassword: true,
      };
      mockMemberService.findByEmail.mockResolvedValue(member);
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(true);

      const result = await service.validateMember(
        'active@test.com',
        'correct_pass',
      );

      expect(result).toEqual({
        id: 'member-1',
        role: MemberRoleEnum.MEMBER,
        requiresPasswordChange: false,
        surface: SessionSurface.MEMBER,
      });
    });
  });

  describe('login', () => {
    it('should return JwtResponse with access_token and refresh_token', async () => {
      mockJwtService.signAsync.mockResolvedValue('mock-token');
      jest
        .spyOn(UtilityService, 'hashValue')
        .mockResolvedValue('hashed_refresh');
      mockSessionService.updateLogin.mockResolvedValue(undefined);
      mockConfigService.get.mockReturnValue('1h');

      const result = await service.login(
        {
          id: 'member-1',
          role: MemberRoleEnum.MEMBER,
          requiresPasswordChange: false,
          surface: SessionSurface.MEMBER,
        },
        'device-abc',
      );

      expect(result).toMatchObject({
        access_token: 'mock-token',
        refresh_token: 'mock-token',
        token_type: 'Bearer',
      });
      expect(result.expires_in).toBeGreaterThanOrEqual(0);
    });

    it('should call sessionService.updateLogin with hashed refresh token', async () => {
      mockJwtService.signAsync.mockResolvedValue('mock-refresh-token');
      jest
        .spyOn(UtilityService, 'hashValue')
        .mockResolvedValue('hashed_refresh_token');
      mockSessionService.updateLogin.mockResolvedValue(undefined);
      mockConfigService.get.mockReturnValue('1h');

      await service.login(
        {
          id: 'member-1',
          role: MemberRoleEnum.MEMBER,
          requiresPasswordChange: false,
          surface: SessionSurface.MEMBER,
        },
        'device-abc',
      );

      expect(mockSessionService.updateLogin).toHaveBeenCalledWith(
        'member-1',
        'hashed_refresh_token',
        SessionSurface.MEMBER,
      );
    });

    it('should generate tokens with correct payload including sub and role', async () => {
      mockJwtService.signAsync.mockResolvedValue('signed-token');
      jest.spyOn(UtilityService, 'hashValue').mockResolvedValue('hashed');
      mockSessionService.updateLogin.mockResolvedValue(undefined);
      mockConfigService.get.mockReturnValue('30m');

      await service.login(
        {
          id: 'worker-id',
          role: MemberRoleEnum.WORKER,
          requiresPasswordChange: false,
          surface: SessionSurface.MEMBER,
        },
        'device-abc',
      );

      expect(mockJwtService.signAsync).toHaveBeenCalledWith({
        sub: 'worker-id',
        role: MemberRoleEnum.WORKER,
        aud: SessionSurface.MEMBER,
      });
    });

    it('should throw ForbiddenException when a different device is already registered', async () => {
      mockMemberService.getById.mockResolvedValueOnce({
        id: 'member-1',
        firstname: 'Test',
        email: 'test@test.com',
        deviceId: 'existing-device',
      });

      await expect(
        service.login(
          {
            id: 'member-1',
            role: MemberRoleEnum.MEMBER,
            requiresPasswordChange: false,
            surface: SessionSurface.MEMBER,
          },
          'new-device',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should register deviceId on first login when deviceId is null', async () => {
      mockJwtService.signAsync.mockResolvedValue('token');
      jest.spyOn(UtilityService, 'hashValue').mockResolvedValue('hashed');
      mockSessionService.updateLogin.mockResolvedValue(undefined);
      mockConfigService.get.mockReturnValue('1h');

      await service.login(
        {
          id: 'member-1',
          role: MemberRoleEnum.MEMBER,
          requiresPasswordChange: false,
          surface: SessionSurface.MEMBER,
        },
        'first-device',
      );

      expect(mockMemberService.setDeviceId).toHaveBeenCalledWith(
        'member-1',
        'first-device',
      );
    });
  });

  describe('adminLogin', () => {
    it('should throw ForbiddenException when member has no admin record', async () => {
      mockAdminService.findByMemberId.mockResolvedValue(null);

      await expect(
        service.adminLogin({
          id: 'member-1',
          role: MemberRoleEnum.MEMBER,
          requiresPasswordChange: false,
          surface: SessionSurface.MEMBER,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should return tokens when member is an active admin', async () => {
      mockAdminService.findByMemberId.mockResolvedValue({
        id: 'admin-1',
        isActive: true,
      });
      mockJwtService.signAsync.mockResolvedValue('admin-token');
      jest.spyOn(UtilityService, 'hashValue').mockResolvedValue('hashed');
      mockSessionService.updateLogin.mockResolvedValue(undefined);
      mockConfigService.get.mockReturnValue('1h');

      const result = await service.adminLogin({
        id: 'member-1',
        role: MemberRoleEnum.MEMBER,
        requiresPasswordChange: false,
        surface: SessionSurface.MEMBER,
      });

      expect(result).toMatchObject({
        access_token: 'admin-token',
        token_type: 'Bearer',
      });
    });
  });

  describe('logout', () => {
    it('should call sessionService.updateLogout with memberId and surface', async () => {
      mockSessionService.updateLogout.mockResolvedValue(undefined);

      await service.logout('member-1', SessionSurface.MEMBER);

      expect(mockSessionService.updateLogout).toHaveBeenCalledWith(
        'member-1',
        SessionSurface.MEMBER,
      );
    });

    it('should complete without error when session exists', async () => {
      mockSessionService.updateLogout.mockResolvedValue(undefined);

      await expect(
        service.logout('member-1', SessionSurface.MEMBER),
      ).resolves.toBeUndefined();
    });

    it('should complete without error even when no session exists', async () => {
      mockSessionService.updateLogout.mockResolvedValue(undefined);

      await expect(
        service.logout('no-session-member', SessionSurface.ADMIN),
      ).resolves.toBeUndefined();
    });

  });

  describe('validateRefreshToken', () => {
    it('should throw UnauthorizedException if no session found', async () => {
      mockSessionService.getHashedRefreshToken.mockResolvedValue(null);

      await expect(
        service.validateRefreshToken(
          'member-1',
          'some-token',
          SessionSurface.MEMBER,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if refresh token is invalid', async () => {
      mockSessionService.getHashedRefreshToken.mockResolvedValue(
        'hashed_valid_token',
      );
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(false);

      await expect(
        service.validateRefreshToken(
          'member-1',
          'invalid-token',
          SessionSurface.MEMBER,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return MemberAuth on success', async () => {
      mockSessionService.getHashedRefreshToken.mockResolvedValue(
        'hashed_refresh',
      );
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(true);
      mockMemberService.getById.mockResolvedValue({
        id: 'member-1',
        role: MemberRoleEnum.WORKER,
        status: MemberStatusEnum.ACTIVE,
        changedPassword: true,
        workerProfile: { id: 'wp-1', status: 'ACTIVE' },
      });

      const result = await service.validateRefreshToken(
        'member-1',
        'valid-refresh-token',
        SessionSurface.MEMBER,
      );

      expect(result).toEqual({
        id: 'member-1',
        role: MemberRoleEnum.WORKER,
        requiresPasswordChange: false,
        surface: SessionSurface.MEMBER,
      });
    });
  });

  describe('validateAccessToken', () => {
    it('should throw UnauthorizedException if no session (hashed token is null)', async () => {
      mockSessionService.getHashedRefreshToken.mockResolvedValue(null);

      await expect(
        service.validateAccessToken('member-1', SessionSurface.MEMBER),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return MemberAuth when session exists', async () => {
      mockSessionService.getHashedRefreshToken.mockResolvedValue(
        'some-hashed-token',
      );
      mockMemberService.getById.mockResolvedValue({
        id: 'member-1',
        role: MemberRoleEnum.MEMBER,
        status: MemberStatusEnum.ACTIVE,
        changedPassword: true,
      });

      const result = await service.validateAccessToken(
        'member-1',
        SessionSurface.MEMBER,
      );

      expect(result).toEqual({
        id: 'member-1',
        role: MemberRoleEnum.MEMBER,
        requiresPasswordChange: false,
        surface: SessionSurface.MEMBER,
      });
    });

    it('should call getById with memberId to retrieve member details', async () => {
      mockSessionService.getHashedRefreshToken.mockResolvedValue('hashed');
      mockMemberService.getById.mockResolvedValue({
        id: 'member-1',
        role: MemberRoleEnum.MEMBER,
        status: MemberStatusEnum.ACTIVE,
      });

      await service.validateAccessToken('member-1', SessionSurface.MEMBER);

      expect(mockMemberService.getById).toHaveBeenCalledWith(
        'member-1',
        expect.any(Array),
      );
    });
  });

  describe('purgeExpiredOtps', () => {
    it('should run the delete query and release the lock when lock is acquired', async () => {
      mockCacheService.acquireLock.mockResolvedValue(true);

      await service.purgeExpiredOtps();

      expect(mockOtpQb.execute).toHaveBeenCalled();
      expect(mockCacheService.releaseLock).toHaveBeenCalledWith(
        'lock:otp-purge',
      );
    });

    it('should skip the delete query when another instance holds the lock', async () => {
      mockCacheService.acquireLock.mockResolvedValue(false);

      await service.purgeExpiredOtps();

      expect(mockOtpQb.execute).not.toHaveBeenCalled();
      expect(mockCacheService.releaseLock).not.toHaveBeenCalled();
    });
  });

  describe('verifyDeviceReset', () => {
    it('unsubscribes push subscription after device is swapped', async () => {
      const member = { id: 'member-1', firstname: 'Test', email: 'test@test.com' };
      const record = {
        memberId: 'member-1',
        newDeviceId: 'new-device-id',
        otpHash: 'hashed-otp',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      };
      mockMemberService.findByEmail.mockResolvedValue(member);
      mockDeviceResetOtpRepository.findOne.mockResolvedValue(record);
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(true);
      jest.spyOn(UtilityService, 'capitalizeFirstLetter').mockReturnValue('Test');
      mockDeviceResetOtpRepository.save.mockResolvedValue(record);
      mockSessionService.updateLogout.mockResolvedValue(undefined);
      mockMemberService.setDeviceId.mockResolvedValue(undefined);
      mockUtilityService.sendEmailWithTemplate.mockResolvedValue(undefined);

      await service.verifyDeviceReset('test@test.com', '123456');

      expect(mockPushService.unsubscribe).toHaveBeenCalledWith('member-1');
    });
  });
});
