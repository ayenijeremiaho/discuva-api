import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { of, throwError, firstValueFrom } from 'rxjs';
import { PlanLimitInterceptor } from './plan-limit.interceptor';
import { PlanFeature } from '../enum/plan-feature.enum';
import { FeatureUsageService } from '../service/feature-usage.service';
import { PlanFeatureResolverService } from '../service/plan-feature-resolver.service';

const mockFeatureUsageService = { tryConsume: jest.fn() };
const mockPlanFeatureResolver = { resolve: jest.fn() };
const mockCls = { get: jest.fn() };

function mockContext(): ExecutionContext {
  return {
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as unknown as ExecutionContext;
}

// tap() runs its side effect synchronously but the consume call inside it
// is fire-and-forget (not awaited by the interceptor) — flush microtasks
// before asserting so the async consumeIfLimited() body has run.
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('PlanLimitInterceptor', () => {
  let interceptor: PlanLimitInterceptor;
  let reflector: Reflector;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanLimitInterceptor,
        Reflector,
        { provide: ClsService, useValue: mockCls },
        {
          provide: PlanFeatureResolverService,
          useValue: mockPlanFeatureResolver,
        },
        { provide: FeatureUsageService, useValue: mockFeatureUsageService },
      ],
    }).compile();
    interceptor = module.get(PlanLimitInterceptor);
    reflector = module.get(Reflector);
  });

  it('is a no-op when the route has no @CountsTowardLimit metadata', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const next: CallHandler = { handle: () => of('ok') };

    await firstValueFrom(interceptor.intercept(mockContext(), next));
    await flush();

    expect(mockPlanFeatureResolver.resolve).not.toHaveBeenCalled();
    expect(mockFeatureUsageService.tryConsume).not.toHaveBeenCalled();
  });

  it('consumes a usage unit after the handler succeeds', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(PlanFeature.GAMES);
    mockCls.get.mockReturnValue('tenant-1');
    mockPlanFeatureResolver.resolve.mockResolvedValue({
      features: [PlanFeature.GAMES],
      featureLimits: { [PlanFeature.GAMES]: 1 },
    });
    const next: CallHandler = { handle: () => of({ id: 'game-1' }) };

    const result = await firstValueFrom(
      interceptor.intercept(mockContext(), next),
    );
    await flush();

    expect(result).toEqual({ id: 'game-1' });
    expect(mockFeatureUsageService.tryConsume).toHaveBeenCalledWith(
      'tenant-1',
      PlanFeature.GAMES,
      1,
    );
  });

  it('does not consume a usage unit when the handler throws', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(PlanFeature.GAMES);
    mockCls.get.mockReturnValue('tenant-1');
    const next: CallHandler = {
      handle: () => throwError(() => new Error('validation failed')),
    };

    await expect(
      firstValueFrom(interceptor.intercept(mockContext(), next)),
    ).rejects.toThrow('validation failed');
    await flush();

    expect(mockFeatureUsageService.tryConsume).not.toHaveBeenCalled();
  });

  it('does not consume when no limit is configured for the feature', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(PlanFeature.GAMES);
    mockCls.get.mockReturnValue('tenant-1');
    mockPlanFeatureResolver.resolve.mockResolvedValue({
      features: [PlanFeature.GAMES],
      featureLimits: {},
    });
    const next: CallHandler = { handle: () => of({ id: 'game-1' }) };

    await firstValueFrom(interceptor.intercept(mockContext(), next));
    await flush();

    expect(mockFeatureUsageService.tryConsume).not.toHaveBeenCalled();
  });
});
