import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { ConfigService } from '@nestjs/config';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { Tenant } from '../entity/tenant.entity';
import { Subscription } from '../../billing/entity/subscription.entity';
import { Member } from '../../member/entity/member.entity';
import { UtilityService } from '../../utility/service/utility.service';

const mockTenantRepo = {
  findOneBy: jest.fn(),
  save: jest.fn(),
  create: jest.fn((v) => v),
};
const mockSubscriptionRepo = {
  findOneBy: jest.fn(),
  save: jest.fn(),
  create: jest.fn((v) => v),
};
const mockDataSource = { query: jest.fn() };
const mockUtilityService = { sendEmailWithTemplate: jest.fn() };
const mockConfigService = {
  get: jest.fn((key: string) =>
    key === 'ADMIN_LOGIN_URL' ? 'https://admin.example.com' : 'Discovery Hub',
  ),
};

// Real runWith/withTransaction set up AsyncLocalStorage + a DB transaction —
// neither is what this spec is testing (trusted elsewhere) — just invoking
// the callback is enough to exercise seedTenantAdmin's real logic.
const mockTx = {
  query: jest.fn(),
  findOneBy: jest.fn(),
  save: jest.fn((entity) => Promise.resolve({ id: 'generated-id', ...entity })),
  create: jest.fn((_entity, data) => data),
};
const mockCls = { runWith: jest.fn((_store, fn) => fn()) };
const mockTxHost = { tx: mockTx, withTransaction: jest.fn((fn) => fn()) };

describe('TenantProvisioningService', () => {
  let service: TenantProvisioningService;

  const baseParams = {
    subdomain: 'test-church',
    churchName: 'Test Church',
    adminFirstname: 'Ada',
    adminLastname: 'Min',
    adminEmail: 'admin@test-church.org',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCls.runWith.mockImplementation((_store, fn) => fn());
    mockTxHost.withTransaction.mockImplementation((fn) => fn());
    mockTx.save.mockImplementation((entity) =>
      Promise.resolve({ id: 'generated-id', ...entity }),
    );
    mockTx.create.mockImplementation((_entity, data) => data);
    mockTx.query.mockResolvedValue([{ c: 0 }]); // no admins yet
    mockTx.findOneBy.mockResolvedValue(null); // no existing role/member

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantProvisioningService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        {
          provide: getRepositoryToken(Subscription),
          useValue: mockSubscriptionRepo,
        },
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
        { provide: UtilityService, useValue: mockUtilityService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    service = module.get(TenantProvisioningService);

    mockTenantRepo.findOneBy.mockResolvedValue(null);
    mockTenantRepo.save.mockImplementation((t) =>
      Promise.resolve({ id: 'tenant-1', ...t }),
    );
    mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
    mockDataSource.query.mockResolvedValue(undefined);
  });

  // provision() itself creates a real, unmocked DataSource inside
  // runTenantMigrations() to run tenant-schema migrations — that's only
  // exercisable against a live Postgres instance (this codebase has no
  // existing precedent of unit-testing provision() end-to-end for exactly
  // this reason). These specs call the private seedTenantAdmin/
  // sendWelcomeEmail methods directly instead, which is where all of this
  // change's actual new logic lives.
  const baseTenant = {
    id: 'tenant-1',
    subdomain: 'test-church',
    schemaName: 'church_test_church',
    name: 'Test Church',
  } as Tenant;

  describe('seedTenantAdmin — no adminPasswordHash supplied (platform-admin path)', () => {
    it('generates a random password, seeds a welcome OTP, and returns it', async () => {
      const otp = await (service as any).seedTenantAdmin(
        baseTenant,
        baseParams,
      );

      const memberSaveCall = mockTx.save.mock.calls.find(
        (call) => call[0]?.email === baseParams.adminEmail,
      );
      expect(memberSaveCall).toBeDefined();
      expect(memberSaveCall[0].password).toEqual(expect.any(String));
      expect(memberSaveCall[0].password).not.toBe('');
      expect(memberSaveCall[0].changedPassword).toBe(false);

      const otpSaveCall = mockTx.save.mock.calls.find(
        (call) => call[0]?.memberId === 'generated-id',
      );
      expect(otpSaveCall).toBeDefined();
      expect(otpSaveCall[0].otpHash).toEqual(expect.any(String));
      expect(otpSaveCall[0].expiresAt.getTime()).toBeGreaterThan(Date.now());

      expect(otp).toMatch(/^\d{6}$/);
    });
  });

  describe('sendWelcomeEmail', () => {
    it('emails the new admin a set-password link built from ADMIN_LOGIN_URL', () => {
      (service as any).sendWelcomeEmail(baseTenant, baseParams, '123456');

      expect(mockUtilityService.sendEmailWithTemplate).toHaveBeenCalledWith(
        baseParams.adminEmail,
        expect.stringContaining(baseParams.churchName),
        'tenant-welcome',
        expect.objectContaining({
          email: baseParams.adminEmail,
          otp: '123456',
          set_password_url: `https://admin.example.com/set-password?email=${encodeURIComponent(baseParams.adminEmail)}&otp=123456`,
        }),
      );
    });
  });

  describe('seedTenantAdmin — adminPasswordHash supplied (self-serve signup / branch invite)', () => {
    it('uses the caller-supplied hash, sets changedPassword true, and generates no OTP', async () => {
      const otp = await (service as any).seedTenantAdmin(baseTenant, {
        ...baseParams,
        adminPasswordHash: 'caller-supplied-hash',
      });

      const memberSaveCall = mockTx.save.mock.calls.find(
        (call) => call[0]?.email === baseParams.adminEmail,
      );
      expect(memberSaveCall[0].password).toBe('caller-supplied-hash');
      expect(memberSaveCall[0].changedPassword).toBe(true);

      const otpSaveCall = mockTx.save.mock.calls.find(
        (call) => call[0]?.otpHash !== undefined,
      );
      expect(otpSaveCall).toBeUndefined();
      expect(otp).toBeNull();
    });
  });

  describe('seedTenantAdmin — resuming an already-seeded tenant', () => {
    it('does not regenerate a password/OTP', async () => {
      mockTx.query.mockResolvedValue([{ c: 1 }]); // an admin already exists

      const otp = await (service as any).seedTenantAdmin(
        baseTenant,
        baseParams,
      );

      expect(mockTx.findOneBy).not.toHaveBeenCalledWith(
        Member,
        expect.anything(),
      );
      expect(otp).toBeNull();
    });
  });

  describe('provision — reserved subdomain', () => {
    it('rejects a reserved subdomain before touching the database', async () => {
      await expect(
        service.provision({ ...baseParams, subdomain: 'admin' }),
      ).rejects.toThrow('reserved subdomain');
      expect(mockTenantRepo.findOneBy).not.toHaveBeenCalled();
    });
  });
});
