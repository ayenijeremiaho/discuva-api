import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Validates the 'platform-admin-jwt' strategy only — never accepts a tenant
 * JWT, even a valid one, because it's a different Passport strategy entirely
 * (separate secret, see platform-admin-jwt.config.ts). Never apply this
 * guard to a tenant-facing route, and never apply JwtAuthGuard/AdminGuard to
 * a /platform/* route — the two auth boundaries must stay disjoint.
 */
@Injectable()
export class PlatformAdminGuard extends AuthGuard('platform-admin-jwt') {}
