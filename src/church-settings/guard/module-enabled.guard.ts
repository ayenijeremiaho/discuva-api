import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { MODULE_KEY } from '../decorator/requires-module.decorator';
import { ChurchSettingsService } from '../service/church-settings.service';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { PlanFeatureResolverService } from '../../billing/service/plan-feature-resolver.service';

@Injectable()
export class ModuleEnabledGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly churchSettingsService: ChurchSettingsService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly planFeatureResolver: PlanFeatureResolverService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const moduleKey = this.reflector.getAllAndOverride<string>(MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!moduleKey) return true;
    const enabled = await this.churchSettingsService.isEnabled(moduleKey);
    if (!enabled)
      throw new ForbiddenException('This module is currently disabled.');

    // Whether this module's own key is included in the tenant's plan —
    // makes every module a plan-assignable capability without needing a
    // separate @RequiresPlan decorator: a platform admin moves a module
    // between Free and Pro by editing Plan.features, no deploy required.
    // Same defensive tenantId fallback as PlanGuard (routes excluded from
    // TenantMiddleware never carry @RequiresModule anyway).
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) return true;

    const { features, overrides } =
      await this.planFeatureResolver.resolve(tenantId);

    // Tenant.moduleOverrides — a platform-admin manual override, checked
    // ahead of plan membership either direction: `false` blocks access
    // regardless of what the plan includes (pulling one tenant's access
    // without touching their plan or anyone else on it); `true` grants
    // access regardless of plan (comping a specific church, or rolling a
    // feature out to hand-picked tenants before a real paid tier for it
    // exists). A key simply absent means no override — fall through to the
    // plan check below, unchanged from before this existed.
    const override = overrides[moduleKey];
    if (override === false) {
      throw new ForbiddenException(
        'This feature has been disabled for your account.',
      );
    }
    if (override === true) return true;

    if (!features.includes(moduleKey)) {
      throw new ForbiddenException({
        message: 'This feature requires an upgraded plan.',
        code: 'PLAN_UPGRADE_REQUIRED',
        requiredFeature: moduleKey,
      });
    }

    return true;
  }
}
