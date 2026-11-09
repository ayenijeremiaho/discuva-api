import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import type { Request } from 'express';
import { AuthService } from '../service/auth.service';
import { clientIp } from '../../utility/client-ip';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy, 'local') {
  constructor(private readonly authService: AuthService) {
    super({ usernameField: 'email', passReqToCallback: true });
  }

  async validate(
    req: Request & { body?: { deviceId?: unknown } },
    email: string,
    password: string,
  ) {
    const deviceId =
      typeof req.body?.deviceId === 'string' ? req.body.deviceId : undefined;
    // The portal has no phone to count by, so its wrong passwords count per network address.
    const portal = req.path?.endsWith('/admin-login')
      ? { ip: clientIp(req) }
      : undefined;
    const user = await this.authService.validateMember(
      email,
      password,
      deviceId,
      portal,
    );
    if (!user) throw new UnauthorizedException('Invalid email or password');
    return user;
  }
}
