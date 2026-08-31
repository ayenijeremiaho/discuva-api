import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PlanFeatureResolverService } from './plan-feature-resolver.service';
import { Plan } from '../entity/plan.entity';
import { Subscription } from '../entity/subscription.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { CacheService } from '../../utility/service/cache.service';

const mockSubscriptionRepo = { findOne: jest.fn() };
const mockPlanRepo = { findOne: jest.fn() };
const mockTenantRepo = { findOne: jest.fn() };
const mockCacheService = {
  // Passes the factory straight through — these tests exercise
  // fetchFromDb's actual logic, not the cache layer itself.
  getOrSet: jest.fn((_key: string, factory: () => unknown) => factory()),
};

describe('PlanFeatureResolverService', () => {
  let service: PlanFeatureResolverService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanFeatureResolverService,
        {
          provide: getRepositoryToken(Subscription),
          useValue: mockSubscriptionRepo,
        },
        { provide: getRepositoryToken(Plan), useValue: mockPlanRepo },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: CacheService, useValue: mockCacheService },
      ],
    }).compile();
    service = module.get(PlanFeatureResolverService);
  });

  it('returns empty features/limits but still returns overrides when the tenant has no subscription', async () => {
    mockTenantRepo.findOne.mockResolvedValue({
      moduleOverrides: { social_media: true },
    });
    mockSubscriptionRepo.findOne.mockResolvedValue(null);

    const result = await service.resolve('tenant-1');

    expect(result).toEqual({
      features: [],
      featureLimits: {},
      overrides: { social_media: true },
    });
  });

  it('returns an empty overrides object when the tenant has none set', async () => {
    mockTenantRepo.findOne.mockResolvedValue({ moduleOverrides: null });
    mockSubscriptionRepo.findOne.mockResolvedValue({ planId: 'pro' });
    mockPlanRepo.findOne.mockResolvedValue({
      features: ['prayer'],
      featureLimits: {},
    });

    const result = await service.resolve('tenant-1');

    expect(result.overrides).toEqual({});
  });

  it('combines plan features with tenant overrides', async () => {
    mockTenantRepo.findOne.mockResolvedValue({
      moduleOverrides: { social_media: true, forms: false },
    });
    mockSubscriptionRepo.findOne.mockResolvedValue({ planId: 'pro' });
    mockPlanRepo.findOne.mockResolvedValue({
      features: ['prayer', 'sermons'],
      featureLimits: { bulk_export: 100 },
    });

    const result = await service.resolve('tenant-1');

    expect(result).toEqual({
      features: ['prayer', 'sermons'],
      featureLimits: { bulk_export: 100 },
      overrides: { social_media: true, forms: false },
    });
  });

  it('still returns overrides for a tenant row that could not be found (defensive default)', async () => {
    mockTenantRepo.findOne.mockResolvedValue(null);
    mockSubscriptionRepo.findOne.mockResolvedValue(null);

    const result = await service.resolve('tenant-1');

    expect(result.overrides).toEqual({});
  });
});
