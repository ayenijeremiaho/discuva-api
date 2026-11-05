import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from '../service/auth.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy, 'local') {
  constructor(private readonly authService: AuthService) {
    super({ usernameField: 'email', passReqToCallback: true });
  }

  async validate(
    req: { body?: { deviceId?: unknown } },
    email: string,
    password: string,
  ) {
    const deviceId =
      typeof req.body?.deviceId === 'string' ? req.body.deviceId : undefined;
    const user = await this.authService.validateMember(
      email,
      password,
      deviceId,
    );
    if (!user) throw new UnauthorizedException('Invalid email or password');
    return user;
  }
}
