import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { PlatformTenantService } from './platform-tenant.service';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { Subscription } from '../../billing/entity/subscription.entity';
import { Plan } from '../../billing/entity/plan.entity';
import { TenantProvisioningService } from '../../tenant/service/tenant-provisioning.service';
import { CacheService } from '../../utility/service/cache.service';

const mockTenantRepo = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  save: jest.fn(),
};
const mockSubscriptionRepo = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  save: jest.fn(),
  create: jest.fn((v) => v),
};
const mockPlanRepo = { findOneBy: jest.fn() };
const mockDataSource = { query: jest.fn() };
const mockProvisioningService = { provision: jest.fn() };
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
          createdAt: baseTenant.createdAt,
          planId: 'pro',
          subscriptionStatus: 'active',
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
    it('provisions the tenant and returns the same curated health shape as listTenants', async () => {
      mockProvisioningService.provision.mockResolvedValue({ ...baseTenant });
      mockSubscriptionRepo.findOneBy.mockResolvedValue({
        planId: 'free',
        status: 'active',
      });
      mockDataSource.query.mockResolvedValue([{ c: 0 }]);

      const result = await service.createTenant({
        subdomain: 'test-church',
        churchName: 'Test Church',
        adminFirstname: 'Ada',
        adminLastname: 'Min',
        adminEmail: 'admin@test-church.org',
      } as any);

      expect(mockProvisioningService.provision).toHaveBeenCalled();
      expect(result.planId).toBe('free');
      expect(result).not.toHaveProperty('schemaName');
    });

    it('never passes an adminPasswordHash — the platform admin has no password to give', async () => {
      mockProvisioningService.provision.mockResolvedValue({ ...baseTenant });
      mockSubscriptionRepo.findOneBy.mockResolvedValue({
        planId: 'free',
        status: 'active',
      });
      mockDataSource.query.mockResolvedValue([{ c: 0 }]);

      await service.createTenant({
        subdomain: 'test-church',
        churchName: 'Test Church',
        adminFirstname: 'Ada',
        adminLastname: 'Min',
        adminEmail: 'admin@test-church.org',
      } as any);

      expect(mockProvisioningService.provision).toHaveBeenCalledWith(
        expect.not.objectContaining({ adminPasswordHash: expect.anything() }),
      );
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
});
