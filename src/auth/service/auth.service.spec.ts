import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { AuthService } from './auth.service';
import { AdminService } from '../../admin/service/admin.service';
import { MemberService } from '../../member/service/member.service';
import { MemberSessionService } from '../../member/service/member-session.service';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { CacheService } from '../../utility/service/cache.service';
import { PasswordResetOtp } from '../entity/password-reset-otp.entity';
import { DeviceResetOtp } from '../entity/device-reset-otp.entity';
import { EmailChangeOtp } from '../entity/email-change-otp.entity';
import { DepartmentLead } from '../../department/entity/department-lead.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';
import { WorkerStatusEnum } from '../../member/enums/worker-status.enum';
import refreshJwtConfig from '../../config/refresh.jwt.config';
import { SessionSurface } from '../enum/session-surface.enum';
import { PushNotificationService } from '../../push-notification/service/push-notification.service';
import { WebauthnService } from './webauthn.service';

const mockUtilityService = {
  sendEmailWithTemplate: jest.fn(),
  sendEmail: jest.fn(),
  resolveTenantLoginUrl: jest
    .fn()
    .mockResolvedValue('https://login.example.com'),
};

const mockAuditLogService = { log: jest.fn() };

const mockPushService = { unsubscribe: jest.fn() };

const mockWebauthnService = { revokeAllCredentials: jest.fn() };

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
  blacklistJti: jest.fn().mockResolvedValue(undefined),
  isJtiBlacklisted: jest.fn().mockResolvedValue(false),
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

const mockEmailChangeOtpRepository = {
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  delete: jest.fn(),
};

const mockDepartmentLeadRepo = { exists: jest.fn().mockResolvedValue(false) };

const mockTenantRepo = {
  find: jest
    .fn()
    .mockResolvedValue([{ id: 't1', subdomain: 'a', schemaName: 'church_a' }]),
};
const mockCls = {
  runWith: jest.fn((_store: unknown, fn: () => unknown) => fn()),
  get: jest.fn(),
};
const mockTxHost = {
  tx: { query: jest.fn() },
  withTransaction: jest.fn((fn: () => unknown) => fn()),
};

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
  // deviceId is `select: false` on the entity — login() must use this method
  // (which explicitly selects it, like it does for password) rather than
  // getById(), which would silently return deviceId: undefined.
  getByIdWithCredentials: jest.fn().mockResolvedValue({
    id: 'member-1',
    firstname: 'Test',
    email: 'test@test.com',
    deviceId: null,
  }),
  signup: jest.fn(),
  changePassword: jest.fn(),
  setDeviceId: jest.fn().mockResolvedValue(undefined),
  updateEmail: jest.fn().mockResolvedValue(undefined),
};

const mockSessionService = {
  updateLogout: jest.fn(),
  updateLogin: jest.fn(),
  getHashedRefreshToken: jest.fn(),
  getSession: jest.fn(),
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
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', subdomain: 'a', schemaName: 'church_a' },
    ]);

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
          provide: getRepositoryToken(EmailChangeOtp),
          useValue: mockEmailChangeOtpRepository,
        },
        {
          provide: getRepositoryToken(DepartmentLead),
          useValue: mockDepartmentLeadRepo,
        },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: PushNotificationService, useValue: mockPushService },
        { provide: WebauthnService, useValue: mockWebauthnService },
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
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

    it('should throw UnauthorizedException if role is WORKER but workerProfile is INACTIVE', async () => {
      const member = {
        id: 'member-1',
        email: 'worker@test.com',
        password: 'hashed_pass',
        status: MemberStatusEnum.ACTIVE,
        role: MemberRoleEnum.WORKER,
        changedPassword: true,
        workerProfile: { id: 'wp-1', status: WorkerStatusEnum.INACTIVE },
      };
      mockMemberService.findByEmail.mockResolvedValue(member);
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(true);

      await expect(
        service.validateMember('worker@test.com', 'correct_pass'),
      ).rejects.toThrow(UnauthorizedException);
    });

    // Regression: revokeWorker()/demoteTraineeToMember() keep the
    // WorkerProfile row (status INACTIVE) instead of deleting it, so a plain
    // MEMBER with that history must still be able to log in — the suspended
    // check must only gate people currently holding the WORKER role.
    it('should allow login for a MEMBER-role account with a leftover INACTIVE workerProfile', async () => {
      const member = {
        id: 'member-1',
        email: 'demoted@test.com',
        password: 'hashed_pass',
        status: MemberStatusEnum.ACTIVE,
        role: MemberRoleEnum.MEMBER,
        changedPassword: true,
        workerProfile: { id: 'wp-1', status: WorkerStatusEnum.INACTIVE },
      };
      mockMemberService.findByEmail.mockResolvedValue(member);
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(true);

      const result = await service.validateMember(
        'demoted@test.com',
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

      expect(mockJwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'worker-id',
          role: MemberRoleEnum.WORKER,
          aud: SessionSurface.MEMBER,
        }),
      );
    });

    it('embeds tenant claims on a member-surface token too — discuva-member calls a dedicated API host, not a tenant-carrying one', async () => {
      mockJwtService.signAsync.mockResolvedValue('signed-token');
      jest.spyOn(UtilityService, 'hashValue').mockResolvedValue('hashed');
      mockSessionService.updateLogin.mockResolvedValue(undefined);
      mockConfigService.get.mockReturnValue('1h');
      mockCls.get.mockImplementation((key: string) =>
        key === 'tenantId'
          ? 'tenant-1'
          : key === 'schemaName'
            ? 'church_alpha'
            : undefined,
      );

      await service.login(
        {
          id: 'member-1',
          role: MemberRoleEnum.MEMBER,
          requiresPasswordChange: false,
          surface: SessionSurface.MEMBER,
        },
        'device-abc',
      );

      expect(mockJwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          schemaName: 'church_alpha',
        }),
      );
    });

    it('should throw ForbiddenException when a different device is already registered', async () => {
      mockMemberService.getByIdWithCredentials.mockResolvedValueOnce({
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

    it('uses getByIdWithCredentials (not getById) to read the member — deviceId is select:false and getById() would silently return undefined', async () => {
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
        'some-device',
      );

      expect(mockMemberService.getByIdWithCredentials).toHaveBeenCalledWith(
        'member-1',
      );
      expect(mockMemberService.getById).not.toHaveBeenCalled();
    });
  });

  describe('adminLogin', () => {
    it('should throw UnauthorizedException when member has no admin record', async () => {
      mockAdminService.findByMemberId.mockResolvedValue(null);

      await expect(
        service.adminLogin({
          id: 'member-1',
          role: MemberRoleEnum.MEMBER,
          requiresPasswordChange: false,
          surface: SessionSurface.MEMBER,
        }),
      ).rejects.toThrow(UnauthorizedException);
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

    it('embeds the current tenantId/schemaName from CLS in the signed payload', async () => {
      mockAdminService.findByMemberId.mockResolvedValue({
        id: 'admin-1',
        isActive: true,
      });
      mockJwtService.signAsync.mockResolvedValue('admin-token');
      jest.spyOn(UtilityService, 'hashValue').mockResolvedValue('hashed');
      mockSessionService.updateLogin.mockResolvedValue(undefined);
      mockConfigService.get.mockReturnValue('1h');
      mockCls.get.mockImplementation((key: string) =>
        key === 'tenantId'
          ? 'tenant-1'
          : key === 'schemaName'
            ? 'church_alpha'
            : undefined,
      );

      await service.adminLogin({
        id: 'member-1',
        role: MemberRoleEnum.MEMBER,
        requiresPasswordChange: false,
        surface: SessionSurface.ADMIN,
      });

      expect(mockJwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          schemaName: 'church_alpha',
        }),
      );
    });
  });

  describe('loginWithWebauthn', () => {
    beforeEach(() => {
      mockJwtService.signAsync.mockResolvedValue('webauthn-token');
      jest.spyOn(UtilityService, 'hashValue').mockResolvedValue('hashed');
      mockSessionService.updateLogin.mockResolvedValue(undefined);
      mockConfigService.get.mockReturnValue('1h');
    });

    it('throws UnauthorizedException for an inactive member', async () => {
      mockMemberService.getById.mockResolvedValueOnce({
        id: 'member-1',
        role: MemberRoleEnum.MEMBER,
        status: MemberStatusEnum.INACTIVE,
        changedPassword: true,
      });

      await expect(service.loginWithWebauthn('member-1')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException for a worker with no workerProfile', async () => {
      mockMemberService.getById.mockResolvedValueOnce({
        id: 'member-1',
        role: MemberRoleEnum.WORKER,
        status: MemberStatusEnum.ACTIVE,
        changedPassword: true,
        workerProfile: null,
      });

      await expect(service.loginWithWebauthn('member-1')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException for a suspended worker', async () => {
      mockMemberService.getById.mockResolvedValueOnce({
        id: 'member-1',
        role: MemberRoleEnum.WORKER,
        status: MemberStatusEnum.ACTIVE,
        changedPassword: true,
        workerProfile: { id: 'wp-1', status: 'SUSPENDED' },
      });

      await expect(service.loginWithWebauthn('member-1')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('issues tokens and logs MEMBER_LOGIN_WEBAUTHN for an active member', async () => {
      mockMemberService.getById.mockResolvedValueOnce({
        id: 'member-1',
        firstname: 'Test',
        lastname: 'Member',
        email: 'test@test.com',
        role: MemberRoleEnum.MEMBER,
        status: MemberStatusEnum.ACTIVE,
        changedPassword: true,
      });

      const result = await service.loginWithWebauthn('member-1');

      expect(result).toMatchObject({
        access_token: 'webauthn-token',
        token_type: 'Bearer',
      });
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'MEMBER_LOGIN_WEBAUTHN',
        expect.objectContaining({ targetId: 'member-1' }),
      );
    });

    it('never applies the single-deviceId password-login lock', async () => {
      mockMemberService.getById.mockResolvedValueOnce({
        id: 'member-1',
        firstname: 'Test',
        lastname: 'Member',
        email: 'test@test.com',
        role: MemberRoleEnum.MEMBER,
        status: MemberStatusEnum.ACTIVE,
        changedPassword: true,
      });

      await service.loginWithWebauthn('member-1');

      expect(mockMemberService.getByIdWithCredentials).not.toHaveBeenCalled();
      expect(mockMemberService.setDeviceId).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('should call sessionService.updateLogout with memberId and surface', async () => {
      mockSessionService.updateLogout.mockResolvedValue(undefined);

      await service.logout('member-1', SessionSurface.MEMBER, 'test-jti', 3600);

      expect(mockSessionService.updateLogout).toHaveBeenCalledWith(
        'member-1',
        SessionSurface.MEMBER,
      );
    });

    it('should blacklist the jti on logout', async () => {
      mockSessionService.updateLogout.mockResolvedValue(undefined);

      await service.logout('member-1', SessionSurface.MEMBER, 'test-jti', 3600);

      expect(mockCacheService.blacklistJti).toHaveBeenCalledWith(
        'test-jti',
        3600,
      );
    });

    it('should complete without error when session exists', async () => {
      mockSessionService.updateLogout.mockResolvedValue(undefined);

      await expect(
        service.logout('member-1', SessionSurface.MEMBER, 'test-jti', 3600),
      ).resolves.toBeUndefined();
    });

    it('should complete without error even when no session exists', async () => {
      mockSessionService.updateLogout.mockResolvedValue(undefined);

      await expect(
        service.logout(
          'no-session-member',
          SessionSurface.ADMIN,
          'test-jti',
          0,
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('validateRefreshToken', () => {
    const freshSession = (hash: string) => ({
      hashedRefreshToken: hash,
      lastLogin: new Date(),
    });

    it('should throw UnauthorizedException if no session found', async () => {
      mockSessionService.getSession.mockResolvedValue(null);

      await expect(
        service.validateRefreshToken(
          'member-1',
          'some-token',
          SessionSurface.MEMBER,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if refresh token is invalid', async () => {
      mockSessionService.getSession.mockResolvedValue(
        freshSession('hashed_valid_token'),
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
      mockSessionService.getSession.mockResolvedValue(
        freshSession('hashed_refresh'),
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

    it('should throw and clear the session when the session exceeds SESSION_MAX_AGE_DAYS since last login', async () => {
      const thirtyOneDaysAgo = new Date(Date.now() - 31 * 86_400_000);
      mockSessionService.getSession.mockResolvedValue({
        hashedRefreshToken: 'some-hash',
        lastLogin: thirtyOneDaysAgo,
      });
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'SESSION_MAX_AGE_DAYS') return 30;
        return undefined;
      });
      mockSessionService.updateLogout.mockResolvedValue(undefined);

      await expect(
        service.validateRefreshToken(
          'member-1',
          'any-token',
          SessionSurface.MEMBER,
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockSessionService.updateLogout).toHaveBeenCalledWith(
        'member-1',
        SessionSurface.MEMBER,
      );
    });

    it('should not reject a session within SESSION_MAX_AGE_DAYS of last login', async () => {
      const twentyDaysAgo = new Date(Date.now() - 20 * 86_400_000);
      mockSessionService.getSession.mockResolvedValue({
        hashedRefreshToken: 'valid-hash',
        lastLogin: twentyDaysAgo,
      });
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'SESSION_MAX_AGE_DAYS') return 30;
        return undefined;
      });
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(true);
      mockMemberService.getById.mockResolvedValue({
        id: 'member-1',
        role: MemberRoleEnum.MEMBER,
        status: MemberStatusEnum.ACTIVE,
        changedPassword: true,
      });

      await expect(
        service.validateRefreshToken(
          'member-1',
          'valid-refresh-token',
          SessionSurface.MEMBER,
        ),
      ).resolves.toBeDefined();
    });

    it('should not reject a session whose row is old but whose last login is recent (reused session row)', async () => {
      // Regression test: MemberSessionService.updateLogin() upserts the same
      // row across logins — only `lastLogin` moves forward, `createdAt` stays
      // fixed at first-ever login. The max-age check must anchor on `lastLogin`
      // or every login past a stale row's 30-day mark would be rejected on
      // the very next refresh, regardless of how recently the member logged in.
      const fortyDaysAgo = new Date(Date.now() - 40 * 86_400_000);
      const today = new Date();
      mockSessionService.getSession.mockResolvedValue({
        hashedRefreshToken: 'valid-hash',
        createdAt: fortyDaysAgo,
        lastLogin: today,
      });
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'SESSION_MAX_AGE_DAYS') return 30;
        return undefined;
      });
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(true);
      mockMemberService.getById.mockResolvedValue({
        id: 'member-1',
        role: MemberRoleEnum.MEMBER,
        status: MemberStatusEnum.ACTIVE,
        changedPassword: true,
      });

      await expect(
        service.validateRefreshToken(
          'member-1',
          'valid-refresh-token',
          SessionSurface.MEMBER,
        ),
      ).resolves.toBeDefined();

      expect(mockSessionService.updateLogout).not.toHaveBeenCalled();
    });
  });

  describe('validateAccessToken', () => {
    it('should throw UnauthorizedException if no session (hashed token is null)', async () => {
      mockSessionService.getHashedRefreshToken.mockResolvedValue(null);

      await expect(
        service.validateAccessToken(
          'member-1',
          SessionSurface.MEMBER,
          'test-jti',
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if jti is blacklisted', async () => {
      mockCacheService.isJtiBlacklisted.mockResolvedValueOnce(true);

      await expect(
        service.validateAccessToken(
          'member-1',
          SessionSurface.MEMBER,
          'revoked-jti',
        ),
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
        'test-jti',
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

      await service.validateAccessToken(
        'member-1',
        SessionSurface.MEMBER,
        'test-jti',
      );

      expect(mockMemberService.getById).toHaveBeenCalledWith(
        'member-1',
        expect.any(Array),
      );
    });
  });

  describe('getProfile', () => {
    // Regression guard: this relation array is a plain string literal, not
    // a TypeScript symbol, so `tsc` can't catch a stale relation name after
    // an entity rename — this is exactly how 'pastor'/'pastor.pastorTitle'
    // silently survived the Pastor -> Clergy rename and 500'd every
    // GET /auth/me call in production until caught manually.
    it('requests the current clergy relation names, not the pre-rename ones', async () => {
      mockMemberService.getById.mockResolvedValue({
        id: 'member-1',
        workerProfile: null,
      });

      await service.getProfile('member-1');

      expect(mockMemberService.getById).toHaveBeenCalledWith('member-1', [
        'workerProfile',
        'workerProfile.department',
        'workerProfile.secondaryDepartment',
        'clergy',
        'clergy.title',
      ]);
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

    it('runs the purge once per active tenant, entering each tenant context', async () => {
      mockCacheService.acquireLock.mockResolvedValue(true);
      mockTenantRepo.find.mockResolvedValue([
        { id: 't1', subdomain: 'a', schemaName: 'church_a' },
        { id: 't2', subdomain: 'b', schemaName: 'church_b' },
      ]);

      await service.purgeExpiredOtps();

      expect(mockOtpQb.execute).toHaveBeenCalledTimes(2);
      expect(mockTxHost.tx.query).toHaveBeenCalledWith(
        'SET LOCAL search_path TO "church_a", public',
      );
      expect(mockTxHost.tx.query).toHaveBeenCalledWith(
        'SET LOCAL search_path TO "church_b", public',
      );
    });
  });

  describe('token rotation', () => {
    it('stores the outgoing refresh hash in cache when a previous session exists', async () => {
      mockSessionService.getHashedRefreshToken.mockResolvedValue('old-hash');
      mockJwtService.signAsync.mockResolvedValue('new-token');
      jest.spyOn(UtilityService, 'hashValue').mockResolvedValue('new-hashed');
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

      expect(mockCacheService.set).toHaveBeenCalledWith(
        expect.stringContaining('rt_rotated'),
        expect.objectContaining({
          hash: 'old-hash',
          rotatedAt: expect.any(Number),
        }),
        expect.any(Number),
      );
    });

    it('skips rotation cache when no previous session exists (first login)', async () => {
      mockSessionService.getHashedRefreshToken.mockResolvedValue(null);
      mockJwtService.signAsync.mockResolvedValue('first-token');
      jest.spyOn(UtilityService, 'hashValue').mockResolvedValue('first-hashed');
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

      expect(mockCacheService.set).not.toHaveBeenCalledWith(
        expect.stringContaining('rt_rotated'),
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('refreshToken', () => {
    it('returns the replayed tokens as-is without rotating again when present', async () => {
      const replayed = {
        access_token: 'already-issued-access-token',
        refresh_token: 'already-issued-refresh-token',
        expires_in: 300,
        token_type: 'Bearer',
        requires_password_change: false,
      };

      const result = await service.refreshToken({
        id: 'member-1',
        role: MemberRoleEnum.MEMBER,
        requiresPasswordChange: false,
        surface: SessionSurface.MEMBER,
        replayedTokens: replayed,
      });

      expect(result).toBe(replayed);
      expect(mockSessionService.updateLogin).not.toHaveBeenCalled();
    });

    it('rotates and generates new tokens when no replayed tokens are present', async () => {
      mockSessionService.getHashedRefreshToken.mockResolvedValue(null);
      mockJwtService.signAsync.mockResolvedValue('new-token');
      jest.spyOn(UtilityService, 'hashValue').mockResolvedValue('new-hashed');
      mockSessionService.updateLogin.mockResolvedValue(undefined);
      mockConfigService.get.mockReturnValue('1h');

      await service.refreshToken({
        id: 'member-1',
        role: MemberRoleEnum.MEMBER,
        requiresPasswordChange: false,
        surface: SessionSurface.MEMBER,
      });

      expect(mockSessionService.updateLogin).toHaveBeenCalled();
    });
  });

  describe('validateRefreshToken — reuse detection', () => {
    const freshSession = (hash: string) => ({
      hashedRefreshToken: hash,
      lastLogin: new Date(),
    });

    it('detects reuse of a rotated token outside the grace window, invalidates the session, and sends a security alert', async () => {
      mockSessionService.getSession.mockResolvedValue(
        freshSession('current-hash'),
      );
      jest
        .spyOn(UtilityService, 'verifyHashedValue')
        .mockResolvedValueOnce(false) // does not match current hash
        .mockResolvedValueOnce(true); // matches rotated hash → reuse
      mockCacheService.get.mockResolvedValueOnce({
        hash: 'rotated-hash',
        response: { access_token: 'stale' },
        rotatedAt: Date.now() - 60_000, // well outside the 10s grace window
      });
      mockSessionService.updateLogout.mockResolvedValue(undefined);
      mockMemberService.getById.mockResolvedValue({
        id: 'member-1',
        firstname: 'Test',
        email: 'test@test.com',
      });

      await expect(
        service.validateRefreshToken(
          'member-1',
          'stolen-old-token',
          SessionSurface.ADMIN,
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockSessionService.updateLogout).toHaveBeenCalledWith(
        'member-1',
        SessionSurface.ADMIN,
      );
      expect(mockCacheService.del).toHaveBeenCalled();
    });

    it('replays the already-issued tokens when the rotated token is reused within the grace window', async () => {
      mockSessionService.getSession.mockResolvedValue(
        freshSession('current-hash'),
      );
      jest
        .spyOn(UtilityService, 'verifyHashedValue')
        .mockResolvedValueOnce(false) // does not match current hash
        .mockResolvedValueOnce(true); // matches rotated hash → benign race
      const cachedResponse = {
        access_token: 'already-issued-access-token',
        refresh_token: 'already-issued-refresh-token',
        expires_in: 300,
        token_type: 'Bearer',
        requires_password_change: false,
      };
      mockCacheService.get.mockResolvedValueOnce({
        hash: 'rotated-hash',
        response: cachedResponse,
        rotatedAt: Date.now() - 2_000, // 2s ago — within the 10s grace window
      });
      mockMemberService.getById.mockResolvedValue({
        id: 'member-1',
        role: MemberRoleEnum.MEMBER,
        status: MemberStatusEnum.ACTIVE,
        changedPassword: true,
      });

      const result = await service.validateRefreshToken(
        'member-1',
        'just-rotated-token',
        SessionSurface.ADMIN,
      );

      expect(result.replayedTokens).toEqual(cachedResponse);
      expect(mockSessionService.updateLogout).not.toHaveBeenCalled();
      expect(mockCacheService.del).not.toHaveBeenCalled();
    });

    it('does not invalidate session for a generic invalid token (no rotated hash in cache)', async () => {
      mockSessionService.getSession.mockResolvedValue(
        freshSession('current-hash'),
      );
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(false);
      mockCacheService.get.mockResolvedValueOnce(null);

      await expect(
        service.validateRefreshToken(
          'member-1',
          'random-garbage-token',
          SessionSurface.MEMBER,
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockSessionService.updateLogout).not.toHaveBeenCalled();
    });

    it('does not invalidate session when rotated hash is present but does not match', async () => {
      mockSessionService.getSession.mockResolvedValue(
        freshSession('current-hash'),
      );
      jest
        .spyOn(UtilityService, 'verifyHashedValue')
        .mockResolvedValueOnce(false) // does not match current hash
        .mockResolvedValueOnce(false); // does not match rotated hash either
      mockCacheService.get.mockResolvedValueOnce({
        hash: 'rotated-hash',
        response: { access_token: 'irrelevant' },
        rotatedAt: Date.now(),
      });

      await expect(
        service.validateRefreshToken(
          'member-1',
          'unrelated-token',
          SessionSurface.MEMBER,
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockSessionService.updateLogout).not.toHaveBeenCalled();
    });
  });

  describe('verifyDeviceReset', () => {
    it('unsubscribes push subscription after device is swapped', async () => {
      const member = {
        id: 'member-1',
        firstname: 'Test',
        email: 'test@test.com',
      };
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
      jest
        .spyOn(UtilityService, 'capitalizeFirstLetter')
        .mockReturnValue('Test');
      mockDeviceResetOtpRepository.save.mockResolvedValue(record);
      mockSessionService.updateLogout.mockResolvedValue(undefined);
      mockMemberService.setDeviceId.mockResolvedValue(undefined);
      mockUtilityService.sendEmailWithTemplate.mockResolvedValue(undefined);

      await service.verifyDeviceReset('test@test.com', '123456');

      expect(mockPushService.unsubscribe).toHaveBeenCalledWith('member-1');
    });

    it('revokes all WebAuthn credentials so a lost device cannot bypass the reset', async () => {
      const member = {
        id: 'member-1',
        firstname: 'Test',
        email: 'test@test.com',
      };
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
      jest
        .spyOn(UtilityService, 'capitalizeFirstLetter')
        .mockReturnValue('Test');
      mockDeviceResetOtpRepository.save.mockResolvedValue(record);
      mockSessionService.updateLogout.mockResolvedValue(undefined);
      mockMemberService.setDeviceId.mockResolvedValue(undefined);
      mockUtilityService.sendEmailWithTemplate.mockResolvedValue(undefined);

      await service.verifyDeviceReset('test@test.com', '123456');

      expect(mockWebauthnService.revokeAllCredentials).toHaveBeenCalledWith(
        'member-1',
      );
    });
  });

  describe('requestEmailChange', () => {
    it('rejects when the new email is already in use by another member', async () => {
      mockMemberService.findByEmail.mockResolvedValue({ id: 'other-member' });

      await expect(
        service.requestEmailChange('member-1', 'taken@test.com'),
      ).rejects.toThrow(ConflictException);
    });

    it('issues an OTP to the new email address when it is free', async () => {
      mockMemberService.findByEmail.mockResolvedValue(null);
      mockMemberService.getById.mockResolvedValue({
        id: 'member-1',
        firstname: 'Test',
        email: 'old@test.com',
      });
      jest.spyOn(UtilityService, 'hashValue').mockResolvedValue('hashed-otp');
      jest
        .spyOn(UtilityService, 'capitalizeFirstLetter')
        .mockReturnValue('Test');
      mockEmailChangeOtpRepository.create.mockImplementation((v) => v);
      mockEmailChangeOtpRepository.save.mockResolvedValue({});

      await service.requestEmailChange('member-1', 'new@test.com');

      expect(mockEmailChangeOtpRepository.delete).toHaveBeenCalledWith(
        expect.objectContaining({ memberId: 'member-1' }),
      );
      expect(mockEmailChangeOtpRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          memberId: 'member-1',
          newEmail: 'new@test.com',
        }),
      );
      expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
        'new@test.com',
        expect.any(String),
        'email-change-otp',
        expect.any(Object),
      );
    });
  });

  describe('confirmEmailChange', () => {
    it('rejects an invalid or expired code', async () => {
      mockEmailChangeOtpRepository.findOne.mockResolvedValue(null);

      await expect(
        service.confirmEmailChange('member-1', '123456'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects if the new email was taken between request and confirm', async () => {
      mockEmailChangeOtpRepository.findOne.mockResolvedValue({
        memberId: 'member-1',
        newEmail: 'new@test.com',
        otpHash: 'hashed-otp',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      });
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(true);
      mockMemberService.findByEmail.mockResolvedValue({ id: 'someone-else' });

      await expect(
        service.confirmEmailChange('member-1', '123456'),
      ).rejects.toThrow(ConflictException);
    });

    it('updates the member email and sends a confirmation on success', async () => {
      const record = {
        memberId: 'member-1',
        newEmail: 'new@test.com',
        otpHash: 'hashed-otp',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      };
      mockEmailChangeOtpRepository.findOne.mockResolvedValue(record);
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(true);
      jest
        .spyOn(UtilityService, 'capitalizeFirstLetter')
        .mockReturnValue('Test');
      mockMemberService.findByEmail.mockResolvedValue(null);
      mockEmailChangeOtpRepository.save.mockResolvedValue(record);
      mockMemberService.getById.mockResolvedValue({
        id: 'member-1',
        firstname: 'Test',
        email: 'new@test.com',
      });

      await service.confirmEmailChange('member-1', '123456');

      expect(mockMemberService.updateEmail).toHaveBeenCalledWith(
        'member-1',
        'new@test.com',
      );
      expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
        'new@test.com',
        expect.any(String),
        'email-changed-confirmation',
        expect.any(Object),
      );
    });
  });
});
