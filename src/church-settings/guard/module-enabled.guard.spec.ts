import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { ModuleEnabledGuard } from './module-enabled.guard';
import { ChurchSettingsService } from '../service/church-settings.service';
import { PlanFeatureResolverService } from '../../billing/service/plan-feature-resolver.service';

const mockChurchSettingsService = { isEnabled: jest.fn() };
const mockPlanFeatureResolver = { resolve: jest.fn() };
const mockCls = { get: jest.fn() };

function mockContext(): ExecutionContext {
  return {
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as unknown as ExecutionContext;
}

describe('ModuleEnabledGuard', () => {
  let guard: ModuleEnabledGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModuleEnabledGuard,
        Reflector,
        { provide: ChurchSettingsService, useValue: mockChurchSettingsService },
        { provide: ClsService, useValue: mockCls },
        {
          provide: PlanFeatureResolverService,
          useValue: mockPlanFeatureResolver,
        },
      ],
    }).compile();
    guard = module.get(ModuleEnabledGuard);
    reflector = module.get(Reflector);
  });

  it('allows the request through when the route carries no @RequiresModule metadata', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    await expect(guard.canActivate(mockContext())).resolves.toBe(true);
    expect(mockChurchSettingsService.isEnabled).not.toHaveBeenCalled();
  });

  it('throws when the module is disabled for the tenant, without checking the plan', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('prayer');
    mockChurchSettingsService.isEnabled.mockResolvedValue(false);

    await expect(guard.canActivate(mockContext())).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockPlanFeatureResolver.resolve).not.toHaveBeenCalled();
  });

  it('allows the request through when there is no tenant context, once enabled', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('prayer');
    mockChurchSettingsService.isEnabled.mockResolvedValue(true);
    mockCls.get.mockReturnValue(undefined);

    await expect(guard.canActivate(mockContext())).resolves.toBe(true);
  });

  it('throws PLAN_UPGRADE_REQUIRED when the module is enabled but not in the tenant plan', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('prayer');
    mockChurchSettingsService.isEnabled.mockResolvedValue(true);
    mockCls.get.mockReturnValue('tenant-1');
    mockPlanFeatureResolver.resolve.mockResolvedValue({
      features: [],
      featureLimits: {},
      overrides: {},
    });

    await expect(guard.canActivate(mockContext())).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows the request through when the module is enabled and in the tenant plan', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('prayer');
    mockChurchSettingsService.isEnabled.mockResolvedValue(true);
    mockCls.get.mockReturnValue('tenant-1');
    mockPlanFeatureResolver.resolve.mockResolvedValue({
      features: ['prayer'],
      featureLimits: {},
      overrides: {},
    });

    await expect(guard.canActivate(mockContext())).resolves.toBe(true);
  });

  // Tenant.moduleOverrides — platform-admin manual override, independent
  // of plan membership.
  describe('platform-admin module overrides', () => {
    it('blocks the request when a platform admin has explicitly disabled this module for the tenant, even though the plan includes it', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('prayer');
      mockChurchSettingsService.isEnabled.mockResolvedValue(true);
      mockCls.get.mockReturnValue('tenant-1');
      mockPlanFeatureResolver.resolve.mockResolvedValue({
        features: ['prayer'],
        featureLimits: {},
        overrides: { prayer: false },
      });

      await expect(guard.canActivate(mockContext())).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('grants the request when a platform admin has explicitly enabled this module for the tenant, even though the plan does not include it', async () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValue('social_media');
      mockChurchSettingsService.isEnabled.mockResolvedValue(true);
      mockCls.get.mockReturnValue('tenant-1');
      mockPlanFeatureResolver.resolve.mockResolvedValue({
        features: [],
        featureLimits: {},
        overrides: { social_media: true },
      });

      await expect(guard.canActivate(mockContext())).resolves.toBe(true);
    });

    it('falls through to the plan check when this module has no override set', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('prayer');
      mockChurchSettingsService.isEnabled.mockResolvedValue(true);
      mockCls.get.mockReturnValue('tenant-1');
      mockPlanFeatureResolver.resolve.mockResolvedValue({
        features: [],
        featureLimits: {},
        overrides: { some_other_module: true },
      });

      await expect(guard.canActivate(mockContext())).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
