import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import platformAdminJwtConfig from '../config/platform-admin-jwt.config';
import { PlatformAdminController } from './controller/platform-admin.controller';
import { PlatformAdminAuthService } from './service/platform-admin-auth.service';
import { PlatformTenantService } from './service/platform-tenant.service';
import { PlatformPlanService } from './service/platform-plan.service';
import { PlatformCommunicationProviderService } from './service/platform-communication-provider.service';
import { PlatformAdminJwtStrategy } from './strategy/platform-admin-jwt.strategy';
import { PlatformAdmin } from './entity/platform-admin.entity';
import { CommunicationProvider } from './entity/communication-provider.entity';
import { TenantCommunicationProviderConfig } from './entity/tenant-communication-provider-config.entity';
import { SmsWallet } from './entity/sms-wallet.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { Plan } from '../billing/entity/plan.entity';
import { Subscription } from '../billing/entity/subscription.entity';
import { TenantModule } from '../tenant/tenant.module';

@Module({
  imports: [
    ConfigModule.forFeature(platformAdminJwtConfig),
    PassportModule,
    JwtModule.registerAsync(platformAdminJwtConfig.asProvider()),
    TypeOrmModule.forFeature([
      PlatformAdmin,
      Tenant,
      Plan,
      Subscription,
      CommunicationProvider,
      TenantCommunicationProviderConfig,
      SmsWallet,
    ]),
    TenantModule,
  ],
  controllers: [PlatformAdminController],
  providers: [
    PlatformAdminAuthService,
    PlatformAdminJwtStrategy,
    PlatformTenantService,
    PlatformPlanService,
    PlatformCommunicationProviderService,
  ],
})
export class PlatformAdminModule {}
