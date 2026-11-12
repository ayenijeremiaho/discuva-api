import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_ROUTE } from '../decorator/public.decorator';
import { isOverseer } from '../../network-overseer/overseer-access.service';
import { AdminGuard } from '../../admin/guard/admin.guard';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const ok = (await super.canActivate(context)) as boolean;
    // An overseer's pass opens admin pages only, never member or worker ones.
    if (ok && isOverseer(context.switchToHttp().getRequest().user)) {
      const guards = this.reflector.getAllAndMerge<unknown[]>(GUARDS_METADATA, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!guards.includes(AdminGuard)) {
        throw new ForbiddenException({
          message: 'Overseers can only open admin pages.',
          code: 'OVERSEER_READ_ONLY',
        });
      }
    }
    return ok;
  }
}
