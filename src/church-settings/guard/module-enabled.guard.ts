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
    const required = this.reflector.getAllAndOverride<string | string[]>(
      MODULE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;
    const keys = Array.isArray(required) ? required : [required];
    const tenantId = this.cls.get('tenantId');
    let refusal: unknown = new ForbiddenException(
      'This module is currently disabled.',
    );
    for (const key of keys) {
      if (!(await this.churchSettingsService.isEnabled(key))) continue;
      if (!tenantId) return true;
      try {
        await this.planFeatureResolver.assertEntitled(tenantId, key);
        return true;
      } catch (err) {
        refusal = err;
      }
    }
    throw refusal;
  }
}
