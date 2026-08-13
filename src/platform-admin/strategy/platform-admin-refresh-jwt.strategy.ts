import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigType } from '@nestjs/config';
import { Inject, Injectable } from '@nestjs/common';
import { Request } from 'express';
import platformAdminRefreshJwtConfig from '../../config/platform-admin-refresh-jwt.config';
import { PlatformAdminJwtPayload } from '../interface/platform-admin-auth.interface';
import { PlatformAdminAuthService } from '../service/platform-admin-auth.service';

// Cookie name deliberately distinct from the tenant member/admin
// "refresh_token" cookie (auth.controller.ts) -- both are set by the same
// api.discuva.org host (shared across every frontend origin), so reusing
// the same name would let one silently clobber the other for any browser
// that's ever logged into both discuva-admin and discuva-platform.
export const PLATFORM_REFRESH_COOKIE_NAME = 'platform_refresh_token';

@Injectable()
export class PlatformAdminRefreshJwtStrategy extends PassportStrategy(
  Strategy,
  'platform-admin-refresh-jwt',
) {
  constructor(
    @Inject(platformAdminRefreshJwtConfig.KEY)
    refreshJwtConfiguration: ConfigType<typeof platformAdminRefreshJwtConfig>,
    private readonly platformAdminAuthService: PlatformAdminAuthService,
  ) {
    super({
      jwtFromRequest: (req: Request) =>
        req.cookies?.[PLATFORM_REFRESH_COOKIE_NAME] ??
        ExtractJwt.fromAuthHeaderAsBearerToken()(req),
      secretOrKey: refreshJwtConfiguration.secret,
      ignoreExpiration: false,
    });
  }

  async validate(payload: PlatformAdminJwtPayload) {
    return this.platformAdminAuthService.validateById(payload.sub);
  }
}
