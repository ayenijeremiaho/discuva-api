import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigType } from '@nestjs/config';
import jwtConfig from '../../config/jwt.config';
import { JwtPayload } from '../interface/auth.interface';
import { Inject, Injectable } from '@nestjs/common';
import { AuthService } from '../service/auth.service';
import { SessionSurface } from '../enum/session-surface.enum';
import { OverseerAccessService } from '../../network-overseer/overseer-access.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(jwtConfig.KEY) jwtConfiguration: ConfigType<typeof jwtConfig>,
    private readonly authService: AuthService,
    private readonly overseers: OverseerAccessService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: jwtConfiguration.secret,
      ignoreExpiration: false,
    });
  }

  async validate(payload: JwtPayload & { exp: number }) {
    if (payload.aud === SessionSurface.OVERSEER) {
      const overseer = await this.overseers.validatePass(payload);
      return { ...overseer, tokenExp: payload.exp };
    }
    const user = await this.authService.validateAccessToken(
      payload.sub,
      payload.aud,
      payload.jti,
    );
    return { ...user, jti: payload.jti, tokenExp: payload.exp };
  }
}
