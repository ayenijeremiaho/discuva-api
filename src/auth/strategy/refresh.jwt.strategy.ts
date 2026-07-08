import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigType } from '@nestjs/config';
import { JwtPayload } from '../interface/auth.interface';
import { Inject, Injectable } from '@nestjs/common';
import refreshJwtConfig from '../../config/refresh.jwt.config';
import { Request } from 'express';
import { AuthService } from '../service/auth.service';

@Injectable()
export class RefreshJwtStrategy extends PassportStrategy(
  Strategy,
  'refresh-jwt',
) {
  constructor(
    @Inject(refreshJwtConfig.KEY)
    refreshJwtConfiguration: ConfigType<typeof refreshJwtConfig>,
    private readonly authService: AuthService,
  ) {
    super({
      // Cookie takes priority (admin web); Bearer header is the fallback (mobile)
      jwtFromRequest: (req: Request) => {
        if (req.cookies?.refresh_token) {
          return req.cookies.refresh_token;
        }
        return ExtractJwt.fromAuthHeaderAsBearerToken()(req);
      },
      secretOrKey: refreshJwtConfiguration.secret,
      ignoreExpiration: false,
      passReqToCallback: true,
    });
  }

  async validate(request: Request, payload: JwtPayload) {
    const refreshToken =
      request.cookies?.refresh_token ??
      request.get('Authorization')?.replace('Bearer ', '').trim() ??
      '';
    return this.authService.validateRefreshToken(
      payload.sub,
      refreshToken,
      payload.aud,
    );
  }
}
