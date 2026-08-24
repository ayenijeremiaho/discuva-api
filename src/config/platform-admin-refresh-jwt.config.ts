import { JwtSignOptions } from '@nestjs/jwt';
import * as process from 'node:process';
import { registerAs } from '@nestjs/config';
import type { StringValue } from 'ms';

export default registerAs(
  'platform-admin-refresh-jwt-config',
  (): JwtSignOptions => ({
    secret: process.env.PLATFORM_ADMIN_REFRESH_JWT_SECRET,
    expiresIn: process.env.PLATFORM_ADMIN_REFRESH_JWT_EXPIRY_IN as StringValue,
  }),
);
