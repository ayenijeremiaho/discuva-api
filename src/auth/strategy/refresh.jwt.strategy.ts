import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigType } from '@nestjs/config';
import { JwtPayload } from '../interface/auth.interface';
import { Inject, Injectable } from '@nestjs/common';
import refreshJwtConfig from '../../config/refresh.jwt.config';
import { Request } from 'express';
import { AuthService } from '../service/auth.service';

// The request's own Bearer token wins (the member app always sends one); the cookie is the admin web app's. An admin's
// cookie also reaches member apps open in the same browser, and must never refresh the admin's session from there.
export function refreshTokenFrom(req: Request): string | null {
  const bearer = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
  if (bearer) return bearer;
  return (
    (req.cookies as Record<string, string> | undefined)?.refresh_token ?? null
  );
}

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
      jwtFromRequest: (req: Request) => refreshTokenFrom(req),
      secretOrKey: refreshJwtConfiguration.secret,
      ignoreExpiration: false,
      passReqToCallback: true,
    });
  }

  async validate(request: Request, payload: JwtPayload) {
    const refreshToken = refreshTokenFrom(request) ?? '';
    return this.authService.validateRefreshToken(
      payload.sub,
      refreshToken,
      payload.aud,
    );
  }
}
