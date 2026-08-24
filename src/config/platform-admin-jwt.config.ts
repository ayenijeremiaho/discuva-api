import { JwtModuleOptions } from '@nestjs/jwt';
import * as process from 'node:process';
import { registerAs } from '@nestjs/config';
import type { StringValue } from 'ms';

/**
 * Deliberately separate from jwt.config.ts / JWT_SECRET — platform-admin
 * tokens must never validate against the same secret as tenant tokens, so a
 * bug can't cross the two auth boundaries. Not yet in env.validation.ts
 * (optional today because this module isn't wired into AppModule); add it
 * there as required once MULTI_TENANT_MIGRATION.md §9 Phase 5 lands.
 */
export default registerAs(
  'platform-admin-jwt-config',
  (): JwtModuleOptions => ({
    secret: process.env.PLATFORM_ADMIN_JWT_SECRET,
    signOptions: {
      expiresIn: (process.env.PLATFORM_ADMIN_JWT_EXPIRY_IN ??
        '1h') as StringValue,
    },
  }),
);
