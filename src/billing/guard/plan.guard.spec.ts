import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { PlanGuard } from './plan.guard';
import { Subscription } from '../entity/subscription.entity';
import { Plan } from '../entity/plan.entity';
import { PlanFeature } from '../enum/plan-feature.enum';
import { FeatureUsageService } from '../service/feature-usage.service';
import { CacheService } from '../../utility/service/cache.service';

const mockSubscriptionRepo = { findOne: jest.fn() };
const mockPlanRepo = { findOne: jest.fn() };
const mockFeatureUsageService = { tryConsume: jest.fn() };
const mockCacheService = {
  getOrSet: jest
    .fn()
    .mockImplementation((_key: string, fn: () => Promise<unknown>) => fn()),
};
const mockCls = { get: jest.fn() };

function mockContext(): ExecutionContext {
  return {
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as unknown as ExecutionContext;
}

describe('PlanGuard', () => {
  let guard: PlanGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanGuard,
        Reflector,
        { provide: ClsService, useValue: mockCls },
        { provide: CacheService, useValue: mockCacheService },
        { provide: FeatureUsageService, useValue: mockFeatureUsageService },
        {
          provide: getRepositoryToken(Subscription),
          useValue: mockSubscriptionRepo,
        },
        { provide: getRepositoryToken(Plan), useValue: mockPlanRepo },
      ],
    }).compile();
    guard = module.get(PlanGuard);
    reflector = module.get(Reflector);
  });

  it('allows the request through when the route carries no @RequiresPlan metadata', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    await expect(guard.canActivate(mockContext())).resolves.toBe(true);
  });

  it('allows the request through when there is no tenant context', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(PlanFeature.SMS);
    mockCls.get.mockReturnValue(undefined);
    await expect(guard.canActivate(mockContext())).resolves.toBe(true);
  });

  it('throws PLAN_UPGRADE_REQUIRED when the feature is not in the plan', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(PlanFeature.SMS);
    mockCls.get.mockReturnValue('tenant-1');
    mockSubscriptionRepo.findOne.mockResolvedValue({ planId: 'free' });
    mockPlanRepo.findOne.mockResolvedValue({
      features: [],
      featureLimits: {},
    });

    await expect(guard.canActivate(mockContext())).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockFeatureUsageService.tryConsume).not.toHaveBeenCalled();
  });

  it('allows the request through when the feature is included and has no configured limit', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(PlanFeature.SMS);
    mockCls.get.mockReturnValue('tenant-1');
    mockSubscriptionRepo.findOne.mockResolvedValue({ planId: 'pro' });
    mockPlanRepo.findOne.mockResolvedValue({
      features: [PlanFeature.SMS],
      featureLimits: {},
    });

    await expect(guard.canActivate(mockContext())).resolves.toBe(true);
    expect(mockFeatureUsageService.tryConsume).not.toHaveBeenCalled();
  });

  it('consumes a usage slot and allows through when a limit is configured and not yet hit', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(PlanFeature.SMS);
    mockCls.get.mockReturnValue('tenant-1');
    mockSubscriptionRepo.findOne.mockResolvedValue({ planId: 'free' });
    mockPlanRepo.findOne.mockResolvedValue({
      features: [PlanFeature.SMS],
      featureLimits: { [PlanFeature.SMS]: 1 },
    });
    mockFeatureUsageService.tryConsume.mockResolvedValue(true);

    await expect(guard.canActivate(mockContext())).resolves.toBe(true);
    expect(mockFeatureUsageService.tryConsume).toHaveBeenCalledWith(
      'tenant-1',
      PlanFeature.SMS,
      1,
    );
  });

  it('throws PLAN_UPGRADE_REQUIRED when the configured limit is already hit', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(PlanFeature.SMS);
    mockCls.get.mockReturnValue('tenant-1');
    mockSubscriptionRepo.findOne.mockResolvedValue({ planId: 'free' });
    mockPlanRepo.findOne.mockResolvedValue({
      features: [PlanFeature.SMS],
      featureLimits: { [PlanFeature.SMS]: 1 },
    });
    mockFeatureUsageService.tryConsume.mockResolvedValue(false);

    await expect(guard.canActivate(mockContext())).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('treats a tenant with no subscription as having no features and no limits', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(PlanFeature.SMS);
    mockCls.get.mockReturnValue('tenant-1');
    mockSubscriptionRepo.findOne.mockResolvedValue(null);

    await expect(guard.canActivate(mockContext())).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockPlanRepo.findOne).not.toHaveBeenCalled();
  });
});
