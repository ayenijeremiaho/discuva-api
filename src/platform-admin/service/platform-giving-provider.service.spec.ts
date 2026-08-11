import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PlatformGivingProviderService } from './platform-giving-provider.service';
import { GivingProvider } from '../../giving-checkout/entity/giving-provider.entity';
import { TenantGivingProviderConfig } from '../../giving-checkout/entity/tenant-giving-provider-config.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { CacheService } from '../../utility/service/cache.service';
import { TenantBroadcastService } from './tenant-broadcast.service';

const mockProviderRepo = {
  find: jest.fn(),
  findBy: jest.fn(),
  findOneBy: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};
const mockConfigRepo = { find: jest.fn() };
const mockTenantRepo = { findOneBy: jest.fn() };
const mockCacheService = { del: jest.fn() };
const mockTenantBroadcastService = { notifyTenants: jest.fn() };

describe('PlatformGivingProviderService', () => {
  let service: PlatformGivingProviderService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigRepo.find.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformGivingProviderService,
        {
          provide: getRepositoryToken(GivingProvider),
          useValue: mockProviderRepo,
        },
        {
          provide: getRepositoryToken(TenantGivingProviderConfig),
          useValue: mockConfigRepo,
        },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: CacheService, useValue: mockCacheService },
        {
          provide: TenantBroadcastService,
          useValue: mockTenantBroadcastService,
        },
      ],
    }).compile();
    service = module.get(PlatformGivingProviderService);
  });

  describe('listProviders', () => {
    it('lists providers ordered by name', async () => {
      mockProviderRepo.find.mockResolvedValue([{ id: 'paystack' }]);
      const result = await service.listProviders();
      expect(mockProviderRepo.find).toHaveBeenCalledWith({
        order: { name: 'ASC' },
      });
      expect(result).toEqual([{ id: 'paystack' }]);
    });
  });

  describe('registerProvider', () => {
    it('creates a new provider when the id is unused', async () => {
      mockProviderRepo.findOneBy.mockResolvedValue(null);
      mockProviderRepo.create.mockReturnValue({ id: 'kora' });
      mockProviderRepo.save.mockResolvedValue({ id: 'kora' });

      const result = await service.registerProvider({
        id: 'kora',
        name: 'Kora',
      });

      expect(result).toEqual({ id: 'kora' });
    });

    it('throws when a provider with that id already exists', async () => {
      mockProviderRepo.findOneBy.mockResolvedValue({ id: 'kora' });
      await expect(
        service.registerProvider({ id: 'kora', name: 'Kora' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('setActive', () => {
    it('throws NotFoundException for an unknown provider id', async () => {
      mockProviderRepo.findOneBy.mockResolvedValue(null);
      await expect(service.setActive('nope', false)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('does nothing extra when no tenant is configured against the provider', async () => {
      mockProviderRepo.findOneBy.mockResolvedValue({
        id: 'paystack',
        name: 'Paystack',
        isActive: true,
      });
      mockProviderRepo.save.mockImplementation((p) => Promise.resolve(p));
      mockConfigRepo.find.mockResolvedValue([]);

      await service.setActive('paystack', false);

      expect(mockCacheService.del).not.toHaveBeenCalled();
      expect(mockTenantBroadcastService.notifyTenants).not.toHaveBeenCalled();
    });

    it('invalidates the resolved-credential cache for every affected tenant and notifies them', async () => {
      mockProviderRepo.findOneBy.mockResolvedValue({
        id: 'paystack',
        name: 'Paystack',
        isActive: true,
      });
      mockProviderRepo.save.mockImplementation((p) => Promise.resolve(p));
      mockConfigRepo.find.mockResolvedValue([
        { tenantId: 'tenant-1', providerId: 'paystack', isActive: true },
        { tenantId: 'tenant-2', providerId: 'paystack', isActive: true },
      ]);

      await service.setActive('paystack', false);

      expect(mockConfigRepo.find).toHaveBeenCalledWith({
        where: { providerId: 'paystack', isActive: true },
      });
      expect(mockCacheService.del).toHaveBeenCalledWith(
        'giving-provider-config:tenant-1',
      );
      expect(mockCacheService.del).toHaveBeenCalledWith(
        'giving-provider-config:tenant-2',
      );
      expect(mockTenantBroadcastService.notifyTenants).toHaveBeenCalledWith(
        ['tenant-1', 'tenant-2'],
        expect.stringContaining('unavailable'),
        expect.any(String),
      );
    });

    it('sends a "restored" notice, not a "disrupted" one, when reactivating', async () => {
      mockProviderRepo.findOneBy.mockResolvedValue({
        id: 'paystack',
        name: 'Paystack',
        isActive: false,
      });
      mockProviderRepo.save.mockImplementation((p) => Promise.resolve(p));
      mockConfigRepo.find.mockResolvedValue([
        { tenantId: 'tenant-1', providerId: 'paystack', isActive: true },
      ]);

      await service.setActive('paystack', true);

      expect(mockTenantBroadcastService.notifyTenants).toHaveBeenCalledWith(
        ['tenant-1'],
        expect.stringContaining('available again'),
        expect.any(String),
      );
    });
  });

  it('throws NotFoundException for an unknown tenant', async () => {
    mockTenantRepo.findOneBy.mockResolvedValue(null);
    await expect(service.getTenantGivingProviders('tenant-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('returns an empty list when the tenant has no configs at all', async () => {
    mockTenantRepo.findOneBy.mockResolvedValue({ id: 'tenant-1' });
    mockConfigRepo.find.mockResolvedValue([]);

    const result = await service.getTenantGivingProviders('tenant-1');

    expect(result).toEqual({ providers: [] });
    expect(mockProviderRepo.findBy).not.toHaveBeenCalled();
  });

  it('resolves provider names and never touches credentials', async () => {
    mockTenantRepo.findOneBy.mockResolvedValue({ id: 'tenant-1' });
    mockConfigRepo.find.mockResolvedValue([
      { providerId: 'paystack', isActive: true },
    ]);
    mockProviderRepo.findBy.mockResolvedValue([
      { id: 'paystack', name: 'Paystack' },
    ]);

    const result = await service.getTenantGivingProviders('tenant-1');

    expect(result).toEqual({
      providers: [
        { providerId: 'paystack', providerName: 'Paystack', isActive: true },
      ],
    });
  });
});
