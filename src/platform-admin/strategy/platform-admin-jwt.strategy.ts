import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigType } from '@nestjs/config';
import { Inject, Injectable } from '@nestjs/common';
import platformAdminJwtConfig from '../../config/platform-admin-jwt.config';
import { PlatformAdminJwtPayload } from '../interface/platform-admin-auth.interface';
import { PlatformAdminAuthService } from '../service/platform-admin-auth.service';

@Injectable()
export class PlatformAdminJwtStrategy extends PassportStrategy(
  Strategy,
  'platform-admin-jwt',
) {
  constructor(
    @Inject(platformAdminJwtConfig.KEY)
    jwtConfiguration: ConfigType<typeof platformAdminJwtConfig>,
    private readonly platformAdminAuthService: PlatformAdminAuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: jwtConfiguration.secret,
      ignoreExpiration: false,
    });
  }

  async validate(payload: PlatformAdminJwtPayload) {
    return this.platformAdminAuthService.validateById(payload.sub);
  }
}
