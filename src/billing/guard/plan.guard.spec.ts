import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { PlanGuard } from './plan.guard';
import { Subscription } from '../entity/subscription.entity';
import { Plan } from '../entity/plan.entity';
import { PlanFeature } from '../enum/plan-feature.enum';
import { REQUIRES_PLAN_KEY } from '../decorator/requires-plan.decorator';
import { COUNTS_TOWARD_LIMIT_KEY } from '../decorator/counts-toward-limit.decorator';
import { FeatureUsageService } from '../service/feature-usage.service';
import { PlanFeatureResolverService } from '../service/plan-feature-resolver.service';
import { CacheService } from '../../utility/service/cache.service';

const mockSubscriptionRepo = { findOne: jest.fn() };
const mockPlanRepo = { findOne: jest.fn() };
const mockFeatureUsageService = { tryConsume: jest.fn(), getUsage: jest.fn() };
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

// getAllAndOverride is called twice per request (REQUIRES_PLAN_KEY, then
// COUNTS_TOWARD_LIMIT_KEY) — this mocks each key independently rather than
// blanket-returning one value for both.
function mockReflectorReturns(
  reflector: Reflector,
  values: Partial<Record<string, unknown>>,
) {
  jest
    .spyOn(reflector, 'getAllAndOverride')
    .mockImplementation((key: unknown) => values[key as string]);
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
        PlanFeatureResolverService,
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
    mockReflectorReturns(reflector, { [REQUIRES_PLAN_KEY]: undefined });
    await expect(guard.canActivate(mockContext())).resolves.toBe(true);
  });

  it('allows the request through when there is no tenant context', async () => {
    mockReflectorReturns(reflector, { [REQUIRES_PLAN_KEY]: PlanFeature.SMS });
    mockCls.get.mockReturnValue(undefined);
    await expect(guard.canActivate(mockContext())).resolves.toBe(true);
  });

  it('throws PLAN_UPGRADE_REQUIRED when the feature is not in the plan', async () => {
    mockReflectorReturns(reflector, { [REQUIRES_PLAN_KEY]: PlanFeature.SMS });
    mockCls.get.mockReturnValue('tenant-1');
    mockSubscriptionRepo.findOne.mockResolvedValue({ planId: 'free' });
    mockPlanRepo.findOne.mockResolvedValue({
      features: [],
      featureLimits: {},
    });

    await expect(guard.canActivate(mockContext())).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockFeatureUsageService.getUsage).not.toHaveBeenCalled();
  });

  it('allows the request through when the feature is included and has no configured limit', async () => {
    mockReflectorReturns(reflector, { [REQUIRES_PLAN_KEY]: PlanFeature.SMS });
    mockCls.get.mockReturnValue('tenant-1');
    mockSubscriptionRepo.findOne.mockResolvedValue({ planId: 'pro' });
    mockPlanRepo.findOne.mockResolvedValue({
      features: [PlanFeature.SMS],
      featureLimits: {},
    });

    await expect(guard.canActivate(mockContext())).resolves.toBe(true);
    expect(mockFeatureUsageService.getUsage).not.toHaveBeenCalled();
  });

  it('never checks usage on a route without @CountsTowardLimit, even when a limit is configured', async () => {
    mockReflectorReturns(reflector, {
      [REQUIRES_PLAN_KEY]: PlanFeature.GAMES,
      [COUNTS_TOWARD_LIMIT_KEY]: undefined,
    });
    mockCls.get.mockReturnValue('tenant-1');
    mockSubscriptionRepo.findOne.mockResolvedValue({ planId: 'free' });
    mockPlanRepo.findOne.mockResolvedValue({
      features: [PlanFeature.GAMES],
      featureLimits: { [PlanFeature.GAMES]: 1 },
    });

    await expect(guard.canActivate(mockContext())).resolves.toBe(true);
    expect(mockFeatureUsageService.getUsage).not.toHaveBeenCalled();
  });

  it('allows a @CountsTowardLimit route through without consuming when usage is under the limit', async () => {
    mockReflectorReturns(reflector, {
      [REQUIRES_PLAN_KEY]: PlanFeature.GAMES,
      [COUNTS_TOWARD_LIMIT_KEY]: PlanFeature.GAMES,
    });
    mockCls.get.mockReturnValue('tenant-1');
    mockSubscriptionRepo.findOne.mockResolvedValue({ planId: 'free' });
    mockPlanRepo.findOne.mockResolvedValue({
      features: [PlanFeature.GAMES],
      featureLimits: { [PlanFeature.GAMES]: 1 },
    });
    mockFeatureUsageService.getUsage.mockResolvedValue(0);

    await expect(guard.canActivate(mockContext())).resolves.toBe(true);
    expect(mockFeatureUsageService.getUsage).toHaveBeenCalledWith(
      'tenant-1',
      PlanFeature.GAMES,
    );
    // The guard is read-only — PlanLimitInterceptor consumes on success,
    // not this guard.
    expect(mockFeatureUsageService.tryConsume).not.toHaveBeenCalled();
  });

  it('throws PLAN_UPGRADE_REQUIRED when a @CountsTowardLimit route has already hit the limit', async () => {
    mockReflectorReturns(reflector, {
      [REQUIRES_PLAN_KEY]: PlanFeature.GAMES,
      [COUNTS_TOWARD_LIMIT_KEY]: PlanFeature.GAMES,
    });
    mockCls.get.mockReturnValue('tenant-1');
    mockSubscriptionRepo.findOne.mockResolvedValue({ planId: 'free' });
    mockPlanRepo.findOne.mockResolvedValue({
      features: [PlanFeature.GAMES],
      featureLimits: { [PlanFeature.GAMES]: 1 },
    });
    mockFeatureUsageService.getUsage.mockResolvedValue(1);

    await expect(guard.canActivate(mockContext())).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('treats a tenant with no subscription as having no features and no limits', async () => {
    mockReflectorReturns(reflector, { [REQUIRES_PLAN_KEY]: PlanFeature.SMS });
    mockCls.get.mockReturnValue('tenant-1');
    mockSubscriptionRepo.findOne.mockResolvedValue(null);

    await expect(guard.canActivate(mockContext())).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockPlanRepo.findOne).not.toHaveBeenCalled();
  });
});
