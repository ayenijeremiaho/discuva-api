import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import platformAdminJwtConfig from '../config/platform-admin-jwt.config';
import { PlatformAdminController } from './controller/platform-admin.controller';
import { PlatformAdminAuthService } from './service/platform-admin-auth.service';
import { PlatformAdminJwtStrategy } from './strategy/platform-admin-jwt.strategy';

/**
 * Scaffolding only — deliberately NOT imported into AppModule yet. Wiring
 * it in now would expose /platform/* routes backed by services that throw
 * NotImplementedException, which is worse than not existing. Register this
 * module once MULTI_TENANT_MIGRATION.md §9 Phase 5 actually lands (after
 * Phase 1's tenant infrastructure and Phase 3's billing tables exist).
 */
@Module({
  imports: [
    ConfigModule.forFeature(platformAdminJwtConfig),
    PassportModule,
    JwtModule.registerAsync(platformAdminJwtConfig.asProvider()),
  ],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminAuthService, PlatformAdminJwtStrategy],
})
export class PlatformAdminModule {}
