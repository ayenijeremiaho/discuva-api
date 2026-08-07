import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { PlatformGivingProviderService } from './platform-giving-provider.service';
import { GivingProvider } from '../../giving-checkout/entity/giving-provider.entity';
import { TenantGivingProviderConfig } from '../../giving-checkout/entity/tenant-giving-provider-config.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';

const mockProviderRepo = { findBy: jest.fn() };
const mockConfigRepo = { find: jest.fn() };
const mockTenantRepo = { findOneBy: jest.fn() };

describe('PlatformGivingProviderService', () => {
  let service: PlatformGivingProviderService;

  beforeEach(async () => {
    jest.clearAllMocks();
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
      ],
    }).compile();
    service = module.get(PlatformGivingProviderService);
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
