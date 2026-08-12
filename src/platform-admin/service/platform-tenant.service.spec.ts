import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PlatformTenantService } from './platform-tenant.service';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { Subscription } from '../../billing/entity/subscription.entity';
import { Plan } from '../../billing/entity/plan.entity';
import { TenantProvisioningService } from '../../tenant/service/tenant-provisioning.service';
import { TenantOnboardingEvent } from '../../tenant/entity/tenant-onboarding-event.entity';
import { TenantOnboardingStatus } from '../../tenant/enum/tenant-onboarding-status.enum';
import { TenantOnboardingActorType } from '../../tenant/enum/tenant-onboarding-actor-type.enum';
import { CacheService } from '../../utility/service/cache.service';

const mockTenantRepo = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
};
const mockSubscriptionRepo = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  save: jest.fn(),
  create: jest.fn((v) => v),
};
const mockPlanRepo = { findOneBy: jest.fn() };
const mockOnboardingEventRepo = { find: jest.fn() };
const mockDataSource = { query: jest.fn() };
const mockProvisioningService = {
  ensurePendingTenant: jest.fn(),
  recordEvent: jest.fn(),
  provision: jest.fn(),
};
const mockCacheService = { del: jest.fn() };

const baseTenant = {
  id: 'tenant-1',
  subdomain: 'test-church',
  schemaName: 'church_test_church',
  name: 'Test Church',
  logoUrl: 'https://cdn.example.com/logo.png',
  tagline: 'Growing together',
  address: '1 Main St',
  supportEmail: 'help@test-church.org',
  currency: 'NGN',
  timezone: 'Africa/Lagos',
  isActive: true,
  onboardingStatus: TenantOnboardingStatus.ACTIVE,
  createdAt: new Date('2026-01-01'),
};

describe('PlatformTenantService', () => {
  let service: PlatformTenantService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockTenantRepo.save.mockImplementation((t) => Promise.resolve(t));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformTenantService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        {
          provide: getRepositoryToken(Subscription),
          useValue: mockSubscriptionRepo,
        },
        { provide: getRepositoryToken(Plan), useValue: mockPlanRepo },
        {
          provide: getRepositoryToken(TenantOnboardingEvent),
          useValue: mockOnboardingEventRepo,
        },
        {
          provide: TenantProvisioningService,
          useValue: mockProvisioningService,
        },
        { provide: CacheService, useValue: mockCacheService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('secret') },
        },
        { provide: ClsService, useValue: { runWith: jest.fn() } },
        {
          provide: TransactionHost,
          useValue: { tx: {}, withTransaction: jest.fn() },
        },
      ],
    }).compile();
    service = module.get(PlatformTenantService);
  });

  describe('listTenants', () => {
    it('includes branding fields (logoUrl/tagline/address/supportEmail) alongside health stats', async () => {
      mockTenantRepo.find.mockResolvedValue([baseTenant]);
      mockSubscriptionRepo.find.mockResolvedValue([
        { tenantId: 'tenant-1', planId: 'pro', status: 'active' },
      ]);
      mockDataSource.query.mockResolvedValue([{ c: 5 }]);

      const result = await service.listTenants();

      expect(result).toEqual([
        {
          id: 'tenant-1',
          subdomain: 'test-church',
          name: 'Test Church',
          logoUrl: 'https://cdn.example.com/logo.png',
          tagline: 'Growing together',
          address: '1 Main St',
          supportEmail: 'help@test-church.org',
          currency: 'NGN',
          timezone: 'Africa/Lagos',
          isActive: true,
          onboardingStatus: TenantOnboardingStatus.ACTIVE,
          createdAt: baseTenant.createdAt,
          planId: 'pro',
          subscriptionStatus: 'active',
          discountType: null,
          discountValue: null,
          discountReason: null,
          discountExpiresAt: null,
          memberCount: 5,
          eventCount: 5,
        },
      ]);
    });

    it('returns null counts when the schema query fails rather than throwing', async () => {
      mockTenantRepo.find.mockResolvedValue([baseTenant]);
      mockSubscriptionRepo.find.mockResolvedValue([]);
      mockDataSource.query.mockRejectedValue(
        new Error('relation does not exist'),
      );

      const result = await service.listTenants();

      expect(result[0].memberCount).toBeNull();
      expect(result[0].eventCount).toBeNull();
      expect(result[0].planId).toBeNull();
    });
  });

  describe('updateTenant', () => {
    it('applies every provided profile field, not just name', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue({ ...baseTenant });
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      mockDataSource.query.mockResolvedValue([{ c: 0 }]);

      const result = await service.updateTenant('tenant-1', {
        name: 'Renamed Church',
        logoUrl: 'https://cdn.example.com/new-logo.png',
        tagline: 'New tagline',
        address: 'New address',
        supportEmail: 'new@test-church.org',
        currency: 'USD',
        timezone: 'America/New_York',
      });

      expect(mockTenantRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Renamed Church',
          logoUrl: 'https://cdn.example.com/new-logo.png',
          tagline: 'New tagline',
          address: 'New address',
          supportEmail: 'new@test-church.org',
          currency: 'USD',
          timezone: 'America/New_York',
        }),
      );
      expect(result.currency).toBe('USD');
      expect(mockCacheService.del).toHaveBeenCalledWith(
        'tenant-branding:tenant-1',
      );
    });

    it('throws NotFoundException for an unknown tenant', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.updateTenant('missing', { name: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('never leaks internal columns (schemaName, clusterId, sharing flags) to the caller', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue({
        ...baseTenant,
        clusterId: 'default',
        parentTenantId: null,
        shareDataWithParent: true,
        shareGivingWithParent: false,
      });
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      mockDataSource.query.mockResolvedValue([{ c: 0 }]);

      const result = await service.updateTenant('tenant-1', { name: 'x' });

      expect(result).not.toHaveProperty('schemaName');
      expect(result).not.toHaveProperty('clusterId');
      expect(result).not.toHaveProperty('parentTenantId');
      expect(result).not.toHaveProperty('shareDataWithParent');
      expect(result).not.toHaveProperty('shareGivingWithParent');
    });
  });

  describe('createTenant', () => {
    const dto = {
      subdomain: 'test-church',
      churchName: 'Test Church',
      adminFirstname: 'Ada',
      adminLastname: 'Min',
      adminEmail: 'admin@test-church.org',
    } as any;

    beforeEach(() => {
      mockProvisioningService.ensurePendingTenant.mockResolvedValue({
        ...baseTenant,
        isActive: false,
        onboardingStatus: TenantOnboardingStatus.PENDING,
      });
      mockProvisioningService.provision.mockResolvedValue({
        ...baseTenant,
        isActive: true,
        onboardingStatus: TenantOnboardingStatus.PENDING,
      });
      mockSubscriptionRepo.findOneBy.mockResolvedValue({
        planId: 'free',
        status: 'active',
      });
      mockDataSource.query.mockResolvedValue([{ c: 0 }]);
    });

    it('provisions inline, records initiation + completion events, and returns the tenant ACTIVE', async () => {
      const result = await service.createTenant(dto, 'platform-admin-1');

      expect(mockProvisioningService.ensurePendingTenant).toHaveBeenCalledWith(
        dto.subdomain,
        dto.churchName,
        undefined,
        true,
      );
      expect(mockProvisioningService.recordEvent).toHaveBeenCalledWith(
        'tenant-1',
        'PLATFORM_ADMIN_INITIATED',
        TenantOnboardingActorType.PLATFORM_ADMIN,
        { actorId: 'platform-admin-1' },
      );
      expect(mockProvisioningService.provision).toHaveBeenCalledWith(
        expect.objectContaining({
          subdomain: dto.subdomain,
          churchName: dto.churchName,
          adminEmail: dto.adminEmail,
        }),
      );
      expect(mockTenantRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          onboardingStatus: TenantOnboardingStatus.ACTIVE,
        }),
      );
      expect(mockProvisioningService.recordEvent).toHaveBeenCalledWith(
        'tenant-1',
        'PROVISIONING_COMPLETED',
        TenantOnboardingActorType.PLATFORM_ADMIN,
        { actorId: 'platform-admin-1' },
      );
      expect(result.onboardingStatus).toBe(TenantOnboardingStatus.ACTIVE);
      expect(result).not.toHaveProperty('schemaName');
    });

    it('never passes an adminPasswordHash to provision() — the platform admin has no password to give', async () => {
      await service.createTenant(dto, 'platform-admin-1');

      expect(mockProvisioningService.provision).toHaveBeenCalledWith(
        expect.not.objectContaining({ adminPasswordHash: expect.anything() }),
      );
    });

    it('marks the tenant FAILED, records PROVISIONING_FAILED, and rethrows when provisioning fails', async () => {
      mockProvisioningService.provision.mockRejectedValue(
        new Error('CREATE SCHEMA failed'),
      );

      await expect(
        service.createTenant(dto, 'platform-admin-1'),
      ).rejects.toThrow('CREATE SCHEMA failed');

      expect(mockTenantRepo.update).toHaveBeenCalledWith('tenant-1', {
        onboardingStatus: TenantOnboardingStatus.FAILED,
      });
      expect(mockProvisioningService.recordEvent).toHaveBeenCalledWith(
        'tenant-1',
        'PROVISIONING_FAILED',
        TenantOnboardingActorType.PLATFORM_ADMIN,
        {
          actorId: 'platform-admin-1',
          metadata: { error: 'CREATE SCHEMA failed' },
        },
      );
    });
  });

  describe('getOnboardingEvents', () => {
    it('returns the events for an existing tenant, oldest first', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue(baseTenant);
      const events = [
        { event: 'SIGNUP_INITIATED', createdAt: new Date('2026-01-01') },
        { event: 'PROVISIONING_COMPLETED', createdAt: new Date('2026-01-02') },
      ];
      mockOnboardingEventRepo.find.mockResolvedValue(events);

      const result = await service.getOnboardingEvents('tenant-1');

      expect(mockOnboardingEventRepo.find).toHaveBeenCalledWith({
        where: { tenant: { id: 'tenant-1' } },
        order: { createdAt: 'ASC' },
      });
      expect(result).toBe(events);
    });

    it('throws NotFoundException for an unknown tenant', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue(null);

      await expect(service.getOnboardingEvents('missing-id')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockOnboardingEventRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('suspendTenant', () => {
    it('flips isActive and returns the curated health shape', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue({
        ...baseTenant,
        isActive: true,
      });
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      mockDataSource.query.mockResolvedValue([{ c: 0 }]);

      const result = await service.suspendTenant('tenant-1', { suspend: true });

      expect(mockTenantRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
      );
      expect(result.isActive).toBe(false);
      expect(result).not.toHaveProperty('schemaName');
    });
  });

  describe('changeTenantPlan', () => {
    it('creates a new ACTIVE subscription when the tenant has none yet', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue(baseTenant);
      mockPlanRepo.findOneBy.mockResolvedValue({ id: 'plan-pro' });
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      mockSubscriptionRepo.save.mockImplementation((s) => Promise.resolve(s));

      const result = await service.changeTenantPlan('tenant-1', {
        planId: 'plan-pro',
      });

      expect(mockSubscriptionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ planId: 'plan-pro', status: 'active' }),
      );
      expect(result.status).toBe('active');
      expect(mockCacheService.del).toHaveBeenCalledWith(
        'plan-features:tenant-1',
      );
    });

    it('reactivates a CANCELED/PAST_DUE subscription onto the new plan', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue(baseTenant);
      mockPlanRepo.findOneBy.mockResolvedValue({ id: 'plan-pro' });
      mockSubscriptionRepo.findOneBy.mockResolvedValue({
        tenantId: 'tenant-1',
        planId: 'plan-free',
        status: 'past_due',
      });
      mockSubscriptionRepo.save.mockImplementation((s) => Promise.resolve(s));

      const result = await service.changeTenantPlan('tenant-1', {
        planId: 'plan-pro',
      });

      expect(result.planId).toBe('plan-pro');
      expect(result.status).toBe('active');
    });

    it('throws NotFoundException when the plan does not exist', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue(baseTenant);
      mockPlanRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.changeTenantPlan('tenant-1', { planId: 'no-such-plan' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('applyDiscount', () => {
    it('sets the discount fields on the existing subscription', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue(baseTenant);
      mockSubscriptionRepo.findOneBy.mockResolvedValue({
        tenantId: 'tenant-1',
        planId: 'plan-pro',
      });
      mockSubscriptionRepo.save.mockImplementation((s) => Promise.resolve(s));

      const result = await service.applyDiscount('tenant-1', {
        discountType: 'percentage' as any,
        discountValue: 20,
        discountReason: 'Launch promo',
      });

      expect(result.discountType).toBe('percentage');
      expect(result.discountValue).toBe(20);
      expect(result.discountReason).toBe('Launch promo');
      expect(result.discountExpiresAt).toBeNull();
    });

    it('rejects a PERCENTAGE discount over 100', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue(baseTenant);

      await expect(
        service.applyDiscount('tenant-1', {
          discountType: 'percentage' as any,
          discountValue: 150,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the tenant has no subscription yet', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue(baseTenant);
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.applyDiscount('tenant-1', {
          discountType: 'fixed_amount' as any,
          discountValue: 500,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeDiscount', () => {
    it('clears all discount fields', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue(baseTenant);
      mockSubscriptionRepo.findOneBy.mockResolvedValue({
        tenantId: 'tenant-1',
        planId: 'plan-pro',
        discountType: 'percentage',
        discountValue: 20,
        discountReason: 'Launch promo',
        discountExpiresAt: new Date(),
      });
      mockSubscriptionRepo.save.mockImplementation((s) => Promise.resolve(s));

      const result = await service.removeDiscount('tenant-1');

      expect(result.discountType).toBeNull();
      expect(result.discountValue).toBeNull();
      expect(result.discountReason).toBeNull();
      expect(result.discountExpiresAt).toBeNull();
    });
  });
});
