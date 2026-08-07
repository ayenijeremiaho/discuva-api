import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { TenantCurrencyService } from './tenant-currency.service';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { CacheService } from './cache.service';

const mockTenantRepo = { findOneBy: jest.fn() };
const mockCacheService = {
  getOrSet: jest
    .fn()
    .mockImplementation((_key: string, fn: () => Promise<unknown>) => fn()),
};
const mockCls = { get: jest.fn() };

const ENV_DEFAULTS: Record<string, string | number> = {
  CURRENCY_CODE: 'USD',
  CACHE_TTL_REFERENCE_SECONDS: 300,
};
const mockConfigService = { get: jest.fn((key: string) => ENV_DEFAULTS[key]) };

describe('TenantCurrencyService', () => {
  let service: TenantCurrencyService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigService.get.mockImplementation(
      (key: string) => ENV_DEFAULTS[key],
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantCurrencyService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ClsService, useValue: mockCls },
        { provide: CacheService, useValue: mockCacheService },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
      ],
    }).compile();
    service = module.get(TenantCurrencyService);
  });

  it("returns the current tenant's own currency", async () => {
    mockCls.get.mockReturnValue('tenant-1');
    mockTenantRepo.findOneBy.mockResolvedValue({
      id: 'tenant-1',
      currency: 'NGN',
    });

    expect(await service.resolveCurrencyCode()).toBe('NGN');
  });

  it('falls back to the env default when the tenant has no currency set', async () => {
    mockCls.get.mockReturnValue('tenant-1');
    mockTenantRepo.findOneBy.mockResolvedValue({
      id: 'tenant-1',
      currency: null,
    });

    expect(await service.resolveCurrencyCode()).toBe('USD');
  });

  it('falls back to the env default when there is no tenant CLS context', async () => {
    mockCls.get.mockReturnValue(undefined);

    expect(await service.resolveCurrencyCode()).toBe('USD');
    expect(mockTenantRepo.findOneBy).not.toHaveBeenCalled();
  });

  it('falls back to the env default when the tenant row cannot be found', async () => {
    mockCls.get.mockReturnValue('tenant-missing');
    mockTenantRepo.findOneBy.mockResolvedValue(null);

    expect(await service.resolveCurrencyCode()).toBe('USD');
  });

  it('resolves through the cache under the shared tenant-branding key', async () => {
    mockCls.get.mockReturnValue('tenant-1');
    mockTenantRepo.findOneBy.mockResolvedValue({
      id: 'tenant-1',
      currency: 'NGN',
    });

    await service.resolveCurrencyCode();

    expect(mockCacheService.getOrSet).toHaveBeenCalledWith(
      'tenant-branding:tenant-1',
      expect.any(Function),
      300,
    );
  });
});
