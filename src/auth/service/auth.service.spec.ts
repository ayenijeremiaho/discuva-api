import { Test, TestingModule } from '@nestjs/testing';
import { DiscuvaAccountService } from '../../discuva-account/service/discuva-account.service';
import { accountsOffMock } from '../../discuva-account/testing/accounts-off.mock';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { AuthService } from './auth.service';
import { AdminService } from '../../admin/service/admin.service';
import { AdminTwoFactorService } from '../../admin/service/admin-two-factor.service';
import { MemberService } from '../../member/service/member.service';
import { MemberSessionService } from '../../member/service/member-session.service';
import { UtilityService } from '../../utility/service/utility.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
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
import { ChurchTimezoneService } from '../../utility/service/church-timezone.service';

const mockUtilityService = {
  sendEmailWithTemplate: jest.fn(),
  sendEmail: jest.fn(),
  resolveTenantLoginUrl: jest
    .fn()
    .mockResolvedValue('https://login.example.com'),
  resolveChurchName: jest.fn().mockResolvedValue('Test Church'),
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
  key: jest
    .fn()
    .mockImplementation((ns: string, id: string, suffix?: string) =>
      suffix ? `${ns}:${id}:${suffix}` : `${ns}:${id}`,
    ),
  get: jest.fn().mockResolvedValue(0),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(1),
  incr: jest.fn().mockResolvedValue(1),
  getGlobal: jest.fn().mockResolvedValue(0),
  incrGlobal: jest.fn().mockResolvedValue(1),
  delGlobal: jest.fn().mockResolvedValue(1),
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

const mockAdminTwoFactor = {
  createChallenge: jest.fn().mockResolvedValue('challenge-1'),
  isRememberedDevice: jest.fn().mockResolvedValue(false),
  completeChallenge: jest.fn().mockResolvedValue('member-1'),
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
  activatePending: jest.fn().mockResolvedValue(undefined),
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

const SETTING_VALUES: Record<string, number> = {
  login_max_attempts: 5,
  login_lock_minutes: 15,
  portal_login_cap: 20,
  device_reset_max_requests: 3,
  device_reset_window_hours: 24,
  otp_verify_max_attempts: 5,
};
const mockPlatformSettings = {
  getNumber: jest.fn(async (key: string) => SETTING_VALUES[key]),
};

const mockAccounts = accountsOffMock({
  updateMember: (id, patch) =>
    'deviceId' in patch
      ? mockMemberService.setDeviceId(id, patch.deviceId)
      : undefined,
  endSessions: (id) =>
    Promise.all([
      mockSessionService.updateLogout(id, SessionSurface.MEMBER),
      mockSessionService.updateLogout(id, SessionSurface.ADMIN),
    ]),
});

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
        {
          provide: ChurchTimezoneService,
          useValue: {
            get: jest.fn().mockResolvedValue('Africa/Lagos'),
            fallback: 'Africa/Lagos',
          },
        },
        AuthService,
        { provide: MemberService, useValue: mockMemberService },
        { provide: MemberSessionService, useValue: mockSessionService },
        { provide: DiscuvaAccountService, useValue: mockAccounts },
        { provide: PlatformSettingsService, useValue: mockPlatformSettings },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: UtilityService, useValue: mockUtilityService },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: AdminService, useValue: mockAdminService },
        { provide: AdminTwoFactorService, useValue: mockAdminTwoFactor },
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

    it('activates a pending sign-up on its first sign-in', async () => {
      mockMemberService.findByEmail.mockResolvedValue({
        id: 'member-1',
        email: 'new@test.com',
        password: 'hashed_pass',
        status: MemberStatusEnum.PENDING,
        role: MemberRoleEnum.MEMBER,
        changedPassword: false,
      });
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(true);

      await service.validateMember('new@test.com', 'temp_pass');

      expect(mockMemberService.activatePending).toHaveBeenCalledWith(
        'member-1',
      );
    });

    it('leaves an active member alone', async () => {
      mockMemberService.findByEmail.mockResolvedValue({
        id: 'member-1',
        email: 'active@test.com',
        password: 'hashed_pass',
        status: MemberStatusEnum.ACTIVE,
        role: MemberRoleEnum.MEMBER,
        changedPassword: true,
      });
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(true);

      await service.validateMember('active@test.com', 'pass');

      expect(mockMemberService.activatePending).not.toHaveBeenCalled();
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

    it('sends the "new login detected" email when this is a new device (deviceId was null)', async () => {
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

      expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
        'test@test.com',
        expect.stringContaining('New'),
        'login-notification',
        expect.any(Object),
        undefined,
        EmailCategory.LOGIN_ALERT,
      );
    });

    it('does NOT send the "new login detected" email on a repeat login from the already-registered device', async () => {
      mockMemberService.getByIdWithCredentials.mockResolvedValueOnce({
        id: 'member-1',
        firstname: 'Test',
        email: 'test@test.com',
        deviceId: 'existing-device',
      });
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
        'existing-device',
      );

      expect(mockMemberService.setDeviceId).not.toHaveBeenCalled();
      expect(mockUtilityService.sendEmailWithTemplate).not.toHaveBeenCalled();
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

    it('asks for the second step and issues no session when 2FA is on', async () => {
      mockAdminService.findByMemberId.mockResolvedValue({
        id: 'admin-1',
        isActive: true,
        twoFactorEnabledAt: new Date(),
      });
      mockJwtService.signAsync.mockClear();

      const result = await service.adminLogin({
        id: 'member-1',
        role: MemberRoleEnum.MEMBER,
        requiresPasswordChange: false,
        surface: SessionSurface.MEMBER,
      });

      expect(result).toEqual({
        requiresTwoFactor: true,
        challengeToken: 'challenge-1',
      });
      expect(mockJwtService.signAsync).not.toHaveBeenCalled();
    });

    it('skips the second step on a remembered device', async () => {
      mockAdminService.findByMemberId.mockResolvedValue({
        id: 'admin-1',
        isActive: true,
        twoFactorEnabledAt: new Date(),
      });
      mockAdminTwoFactor.isRememberedDevice.mockResolvedValueOnce(true);
      mockJwtService.signAsync.mockResolvedValue('admin-token');
      jest.spyOn(UtilityService, 'hashValue').mockResolvedValue('hashed');
      mockSessionService.updateLogin.mockResolvedValue(undefined);
      mockConfigService.get.mockReturnValue('1h');

      const result = await service.adminLogin(
        {
          id: 'member-1',
          role: MemberRoleEnum.MEMBER,
          requiresPasswordChange: false,
          surface: SessionSurface.MEMBER,
        },
        { c: 'v' },
      );

      expect(mockAdminTwoFactor.isRememberedDevice).toHaveBeenCalledWith(
        'member-1',
        { c: 'v' },
      );
      expect(result).toMatchObject({ access_token: 'admin-token' });
    });

    it('issues the admin session once the second step passes', async () => {
      mockMemberService.getById.mockResolvedValueOnce({
        id: 'member-1',
        role: MemberRoleEnum.MEMBER,
        changedPassword: true,
      });
      mockJwtService.signAsync.mockResolvedValue('admin-token');
      jest.spyOn(UtilityService, 'hashValue').mockResolvedValue('hashed');
      mockSessionService.updateLogin.mockResolvedValue(undefined);
      mockConfigService.get.mockReturnValue('1h');

      const result = await service.completeAdminTwoFactorLogin('c', '123456');

      expect(result).toMatchObject({ access_token: 'admin-token' });
      expect(mockAdminTwoFactor.completeChallenge).toHaveBeenCalledWith(
        'c',
        '123456',
      );
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

    it('should audit-log MEMBER_LOGOUT with actor and target set to the logging-out member', async () => {
      mockSessionService.updateLogout.mockResolvedValue(undefined);

      await service.logout('member-1', SessionSurface.MEMBER, 'test-jti', 3600);

      expect(mockAuditLogService.log).toHaveBeenCalledWith('MEMBER_LOGOUT', {
        actorId: 'member-1',
        targetId: 'member-1',
        targetEmail: 'test@test.com',
        targetName: 'Test undefined',
      });
    });

    it('should audit-log ADMIN_LOGOUT when the surface is ADMIN', async () => {
      mockSessionService.updateLogout.mockResolvedValue(undefined);

      await service.logout('member-1', SessionSurface.ADMIN, 'test-jti', 3600);

      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        'ADMIN_LOGOUT',
        expect.objectContaining({ actorId: 'member-1', targetId: 'member-1' }),
      );
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
        'spouse',
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

    it('records a failed OTP-verify attempt when the code is wrong', async () => {
      mockMemberService.findByEmail.mockResolvedValue({
        id: 'member-1',
        firstname: 'Test',
        email: 'test@test.com',
      });
      mockDeviceResetOtpRepository.findOne.mockResolvedValue({
        memberId: 'member-1',
        newDeviceId: 'new-device-id',
        otpHash: 'hashed-otp',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      });
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(false);

      await expect(
        service.verifyDeviceReset('test@test.com', 'wrong-otp'),
      ).rejects.toThrow(BadRequestException);

      expect(mockCacheService.incr.mock.calls[0][0]).toEqual(
        expect.stringContaining('otp_verify_fail'),
      );
    });

    it('clears the OTP-verify rate limit counter on success', async () => {
      const record = {
        memberId: 'member-1',
        newDeviceId: 'new-device-id',
        otpHash: 'hashed-otp',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      };
      mockMemberService.findByEmail.mockResolvedValue({
        id: 'member-1',
        firstname: 'Test',
        email: 'test@test.com',
      });
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

      expect(mockCacheService.del).toHaveBeenCalledWith(
        expect.stringContaining('otp_verify_fail'),
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

    it('records a failed OTP-verify attempt when the code is wrong', async () => {
      mockEmailChangeOtpRepository.findOne.mockResolvedValue({
        memberId: 'member-1',
        newEmail: 'new@test.com',
        otpHash: 'hashed-otp',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      });
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(false);

      await expect(
        service.confirmEmailChange('member-1', 'wrong-otp'),
      ).rejects.toThrow(BadRequestException);

      expect(mockCacheService.incr.mock.calls[0][0]).toEqual(
        expect.stringContaining('otp_verify_fail'),
      );
    });

    it('clears the OTP-verify rate limit counter on success', async () => {
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

      expect(mockCacheService.del).toHaveBeenCalledWith(
        expect.stringContaining('otp_verify_fail'),
      );
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

  describe("someone else can't block a member's sign-in", () => {
    const member = {
      id: 'member-1',
      firstname: 'Test',
      email: 'test@test.com',
      password: 'hashed_pass',
      deviceId: 'my-phone-123',
      status: MemberStatusEnum.ACTIVE,
      role: MemberRoleEnum.MEMBER,
    };
    const lockedKeys = new Set<string>();
    beforeEach(() => {
      Object.assign(service, {
        loginMaxAttempts: 5,
        deviceResetMaxAttempts: 3,
      });
      lockedKeys.clear();
      mockCacheService.get.mockImplementation((key: string) =>
        Promise.resolve(lockedKeys.has(key) ? 99 : 0),
      );
      mockMemberService.findByEmail.mockResolvedValue(member);
    });
    afterEach(() => mockCacheService.get.mockResolvedValue(0));

    it('lets the registered device sign in while other devices are locked out', async () => {
      lockedKeys.add('login_fail:test@test.com:other');
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(true);

      await expect(
        service.validateMember('test@test.com', 'pass', 'stranger-device'),
      ).rejects.toThrow(HttpException);
      await expect(
        service.validateMember('test@test.com', 'pass', 'my-phone-123'),
      ).resolves.toMatchObject({ id: 'member-1' });
    });

    it('counts wrong passwords from other devices together, whatever device id they send', async () => {
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(false);
      await expect(
        service.validateMember('test@test.com', 'x', 'fake-1'),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.validateMember('test@test.com', 'x'),
      ).rejects.toThrow(UnauthorizedException);
      const keys = mockCacheService.incr.mock.calls.map((c) => c[0]);
      expect(keys).toEqual([
        'login_fail:test@test.com:other',
        'login_fail:test@test.com:other',
      ]);
    });

    it("counts reset requests per device, so a stranger's requests don't use up the member's", async () => {
      lockedKeys.add('device_reset:test@test.com:stranger-device');
      await expect(
        service.requestDeviceReset('test@test.com', 'stranger-device'),
      ).rejects.toThrow(HttpException);
      await service.requestDeviceReset('test@test.com', 'new-phone-456');
      expect(mockDeviceResetOtpRepository.save).toHaveBeenCalled();
    });

    it("doesn't cancel a code another device asked for", async () => {
      await service.requestDeviceReset('test@test.com', 'new-phone-456');
      expect(mockDeviceResetOtpRepository.delete).toHaveBeenCalledWith({
        memberId: 'member-1',
        newDeviceId: 'new-phone-456',
        usedAt: expect.anything(),
      });
    });

    it("checks the code against the asking device's own request and tries", async () => {
      mockDeviceResetOtpRepository.findOne.mockResolvedValue(null);
      await expect(
        service.verifyDeviceReset('test@test.com', '123456', 'new-phone-456'),
      ).rejects.toThrow(BadRequestException);
      expect(mockDeviceResetOtpRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ newDeviceId: 'new-phone-456' }),
        }),
      );
      expect(mockCacheService.incr.mock.calls[0][0]).toBe(
        'otp_verify_fail:test@test.com:new-phone-456:device_reset',
      );
    });

    it('drops every other pending code once a reset succeeds', async () => {
      mockDeviceResetOtpRepository.findOne.mockResolvedValue({
        memberId: 'member-1',
        newDeviceId: 'new-phone-456',
        otpHash: 'hashed-otp',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      });
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(true);
      await service.verifyDeviceReset(
        'test@test.com',
        '123456',
        'new-phone-456',
      );
      expect(mockMemberService.setDeviceId).toHaveBeenCalledWith(
        'member-1',
        'new-phone-456',
      );
      expect(mockDeviceResetOtpRepository.delete).toHaveBeenCalledWith({
        memberId: 'member-1',
        usedAt: expect.anything(),
      });
    });
  });

  describe('with a Discuva account', () => {
    const user = {
      id: 'member-1',
      role: MemberRoleEnum.MEMBER,
      requiresPasswordChange: false,
      surface: SessionSurface.MEMBER,
    };

    beforeEach(() => {
      mockJwtService.signAsync.mockResolvedValue('t');
      mockSessionService.updateLogin.mockResolvedValue(undefined);
      jest.spyOn(UtilityService, 'hashValue').mockResolvedValue('h');
    });

    it('counts wrong passwords across all the churches the account belongs to', async () => {
      mockAccounts.hasAccount.mockResolvedValueOnce(true);
      mockMemberService.findByEmail.mockResolvedValue({
        id: 'member-1',
        email: 'test@test.com',
        password: 'p',
        status: MemberStatusEnum.ACTIVE,
      });
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(false);

      await expect(
        service.validateMember('test@test.com', 'wrong', 'phone'),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockCacheService.getGlobal).toHaveBeenCalledWith(
        'login_fail:test@test.com:other',
      );
      expect(mockCacheService.incrGlobal).toHaveBeenCalled();
      expect(mockCacheService.incr).not.toHaveBeenCalled();
    });

    it('refuses a frozen account even with the right password', async () => {
      mockMemberService.findByEmail.mockResolvedValue({
        id: 'member-1',
        email: 'test@test.com',
        password: 'p',
        status: MemberStatusEnum.ACTIVE,
      });
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(true);
      mockAccounts.isFrozen.mockResolvedValueOnce(true);
      await expect(
        service.validateMember('test@test.com', 'right', 'phone'),
      ).rejects.toThrow('frozen');
    });

    it("checks the device against the account's device, not this church's copy", async () => {
      mockMemberService.getByIdWithCredentials.mockResolvedValue({
        id: 'member-1',
        email: 'test@test.com',
        deviceId: null,
      });
      mockAccounts.deviceOf.mockResolvedValueOnce('their-phone');

      await expect(service.login(user, 'another-phone')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockAccounts.setDevice).not.toHaveBeenCalled();
    });

    it('moves the member over after a good sign-in and says when another church can be linked', async () => {
      mockMemberService.getByIdWithCredentials.mockResolvedValue({
        id: 'member-1',
        email: 'test@test.com',
        deviceId: 'phone',
      });
      mockAccounts.moveOnSignIn.mockResolvedValueOnce('LINK_AVAILABLE');

      const result = await service.login(user, 'phone');

      expect(mockAccounts.moveOnSignIn).toHaveBeenCalled();
      expect(result.account_link_available).toBe(true);
    });
  });

  describe('admin portal sign-in limits', () => {
    const member = {
      id: 'member-1',
      firstname: 'Ada',
      email: 'admin@test.com',
      password: 'p',
      status: MemberStatusEnum.ACTIVE,
      role: MemberRoleEnum.MEMBER,
    };
    const counts = new Map<string, number>();

    beforeEach(() => {
      counts.clear();
      mockMemberService.findByEmail.mockResolvedValue(member);
      mockCacheService.get.mockImplementation(
        async (k: string) => counts.get(k) ?? 0,
      );
      mockCacheService.incr.mockImplementation(async (k: string) => {
        counts.set(k, (counts.get(k) ?? 0) + 1);
        return counts.get(k);
      });
    });
    afterEach(() => {
      mockCacheService.get.mockResolvedValue(0);
      mockCacheService.incr.mockResolvedValue(1);
    });

    it("a stranger's wrong passwords lock out only their own address", async () => {
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(false);
      for (let i = 0; i < 5; i++) {
        await expect(
          service.validateMember('admin@test.com', 'x', undefined, {
            ip: '1.1.1.1',
          }),
        ).rejects.toThrow(UnauthorizedException);
      }
      await expect(
        service.validateMember('admin@test.com', 'x', undefined, {
          ip: '1.1.1.1',
        }),
      ).rejects.toThrow(HttpException);

      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(true);
      await expect(
        service.validateMember('admin@test.com', 'right', undefined, {
          ip: '2.2.2.2',
        }),
      ).resolves.toMatchObject({ id: 'member-1' });
    });

    it('portal tries never touch the member app counts', async () => {
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(false);
      await expect(
        service.validateMember('admin@test.com', 'x', undefined, {
          ip: '1.1.1.1',
        }),
      ).rejects.toThrow(UnauthorizedException);
      expect([...counts.keys()]).toEqual([
        'login_fail:admin@test.com:ip:1.1.1.1',
        'login_fail:admin@test.com:portal',
      ]);
    });

    it('stops everyone once the cap across all addresses is reached, and tells the owner', async () => {
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(false);
      for (let i = 0; i < 20; i++) {
        await expect(
          service.validateMember('admin@test.com', 'x', undefined, {
            ip: `10.0.0.${i}`,
          }),
        ).rejects.toThrow(UnauthorizedException);
      }
      expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledTimes(1);
      await expect(
        service.validateMember('admin@test.com', 'x', undefined, {
          ip: '9.9.9.9',
        }),
      ).rejects.toThrow(HttpException);
    });

    it('takes its limits from the console settings', async () => {
      SETTING_VALUES.login_max_attempts = 3;
      jest.spyOn(UtilityService, 'verifyHashedValue').mockResolvedValue(false);
      try {
        for (let i = 0; i < 3; i++) {
          await expect(
            service.validateMember('admin@test.com', 'x', 'phone-x'),
          ).rejects.toThrow(UnauthorizedException);
        }
        await expect(
          service.validateMember('admin@test.com', 'x', 'phone-x'),
        ).rejects.toThrow(HttpException);
      } finally {
        SETTING_VALUES.login_max_attempts = 5;
      }
    });
  });
});
