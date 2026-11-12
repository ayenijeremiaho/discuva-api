import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_ROUTE } from '../decorator/public.decorator';
import {
  isOverseer,
  OverseerAccessService,
} from '../../network-overseer/overseer-access.service';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { PlanGuard } from '../../billing/guard/plan.guard';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    @Optional() private readonly overseers?: OverseerAccessService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const ok = (await super.canActivate(context)) as boolean;
    const request = context.switchToHttp().getRequest();
    if (ok && isOverseer(request.user)) {
      const guards = this.reflector.getAllAndMerge<unknown[]>(GUARDS_METADATA, [
        context.getHandler(),
        context.getClass(),
      ]);
      // AdminGuard applies the Overseer role and logs the page.
      if (guards.includes(AdminGuard)) return ok;
      if (!this.overseers || !guards.every((g) => OPEN_TO_ANY_MEMBER.has(g))) {
        throw new ForbiddenException({
          message: 'Overseers can only open admin pages.',
          code: 'OVERSEER_READ_ONLY',
        });
      }
      await this.overseers.assertReadOnly(request);
      await this.overseers.recordView(request.user, request);
    }
    return ok;
  }
}

// Routes any signed-in member may read; anything with a role or team check stays closed to overseers.
const OPEN_TO_ANY_MEMBER = new Set<unknown>([
  JwtAuthGuard,
  ModuleEnabledGuard,
  PlanGuard,
]);
