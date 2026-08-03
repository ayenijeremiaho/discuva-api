import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { PlatformAdminAuth } from '../interface/platform-admin-auth.interface';
import { REQUIRES_PLATFORM_PERMISSION_KEY } from '../decorator/requires-platform-permission.decorator';

/**
 * Validates the 'platform-admin-jwt' strategy — never accepts a tenant JWT,
 * even a valid one, because it's a different Passport strategy entirely
 * (separate secret, see platform-admin-jwt.config.ts). Never apply this
 * guard to a tenant-facing route, and never apply JwtAuthGuard/AdminGuard to
 * a /platform/* route — the two auth boundaries must stay disjoint.
 *
 * Also does the job AdminGuard does tenant-side (permission checking) —
 * combined into one guard here, rather than split across a global JWT guard
 * + a separate per-route permission guard, because /platform/* has no
 * global-guard equivalent to lean on (every platform controller applies
 * this guard explicitly). super.canActivate() runs the Passport strategy
 * (validates the token, populates request.user via
 * PlatformAdminAuthService.validateById, which already loads the admin's
 * role + permissions in that same query) before the permission check below
 * ever runs.
 */
@Injectable()
export class PlatformAdminGuard extends AuthGuard('platform-admin-jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const authenticated = (await super.canActivate(context)) as boolean;
    if (!authenticated) return false;

    const required = this.reflector.getAllAndOverride<string>(
      REQUIRES_PLATFORM_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const request = context.switchToHttp().getRequest();
    const admin: PlatformAdminAuth = request.user;
    if (!admin.permissions.includes(required)) {
      throw new ForbiddenException(`Missing required permission: ${required}`);
    }
    return true;
  }
}
