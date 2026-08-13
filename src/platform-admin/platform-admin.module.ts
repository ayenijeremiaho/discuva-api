import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import platformAdminJwtConfig from '../config/platform-admin-jwt.config';
import platformAdminRefreshJwtConfig from '../config/platform-admin-refresh-jwt.config';
import { PlatformAdminController } from './controller/platform-admin.controller';
import { PlatformAnalyticsController } from './controller/platform-analytics.controller';
import { PlatformAdminRoleController } from './controller/platform-admin-role.controller';
import { PlatformAdminManagementController } from './controller/platform-admin-management.controller';
import { PlatformAdminAuthService } from './service/platform-admin-auth.service';
import { PlatformTenantService } from './service/platform-tenant.service';
import { PlatformPlanService } from './service/platform-plan.service';
import { PlatformCapabilityService } from './service/platform-capability.service';
import { PlatformCommunicationProviderService } from './service/platform-communication-provider.service';
import { PlatformGivingProviderService } from './service/platform-giving-provider.service';
import { PlatformPaymentProviderService } from './service/platform-payment-provider.service';
import { PlatformAnalyticsService } from './service/platform-analytics.service';
import { PlatformAdminRoleService } from './service/platform-admin-role.service';
import { PlatformAdminManagementService } from './service/platform-admin-management.service';
import { TenantBroadcastService } from './service/tenant-broadcast.service';
import { PlatformAdminJwtStrategy } from './strategy/platform-admin-jwt.strategy';
import { PlatformAdminRefreshJwtStrategy } from './strategy/platform-admin-refresh-jwt.strategy';
import { PlatformAdminGuard } from './guard/platform-admin.guard';
import { PlatformAdminRefreshJwtAuthGuard } from './guard/platform-admin-refresh-jwt-auth.guard';
import { DefaultPlatformAdminSeed } from './seed/default-platform-admin.seed';
import { PlatformAdmin } from './entity/platform-admin.entity';
import { PlatformAdminRole } from './entity/platform-admin-role.entity';
import { PlatformAdminPasswordResetOtp } from './entity/platform-admin-password-reset-otp.entity';
import { PlatformSetting } from './entity/platform-setting.entity';
import { PlatformSettingsService } from './service/platform-settings.service';
import { CommunicationProvider } from './entity/communication-provider.entity';
import { TenantCommunicationProviderConfig } from './entity/tenant-communication-provider-config.entity';
import { GivingProvider } from '../giving-checkout/entity/giving-provider.entity';
import { TenantGivingProviderConfig } from '../giving-checkout/entity/tenant-giving-provider-config.entity';
import { GivingCheckoutSession } from '../giving-checkout/entity/giving-checkout-session.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { Plan } from '../billing/entity/plan.entity';
import { Subscription } from '../billing/entity/subscription.entity';
import { BillingCheckoutSession } from '../billing/entity/billing-checkout-session.entity';
import { PlatformPaymentProvider } from '../billing/entity/payment-provider.entity';
import { TenantRollup } from '../branch/entity/tenant-rollup.entity';
import { TenantModule } from '../tenant/tenant.module';
import { TenantOnboardingEvent } from '../tenant/entity/tenant-onboarding-event.entity';
import { UtilityModule } from '../utility/utility.module';

@Module({
  imports: [
    ConfigModule.forFeature(platformAdminJwtConfig),
    ConfigModule.forFeature(platformAdminRefreshJwtConfig),
    PassportModule,
    JwtModule.registerAsync(platformAdminJwtConfig.asProvider()),
    TypeOrmModule.forFeature([
      PlatformAdmin,
      PlatformAdminRole,
      PlatformAdminPasswordResetOtp,
      PlatformSetting,
      Tenant,
      Plan,
      Subscription,
      CommunicationProvider,
      TenantCommunicationProviderConfig,
      GivingProvider,
      TenantGivingProviderConfig,
      GivingCheckoutSession,
      BillingCheckoutSession,
      PlatformPaymentProvider,
      TenantRollup,
      TenantOnboardingEvent,
    ]),
    TenantModule,
    UtilityModule,
  ],
  controllers: [
    PlatformAdminController,
    PlatformAnalyticsController,
    PlatformAdminRoleController,
    PlatformAdminManagementController,
  ],
  providers: [
    PlatformAdminAuthService,
    PlatformAdminJwtStrategy,
    PlatformAdminRefreshJwtStrategy,
    PlatformAdminRefreshJwtAuthGuard,
    PlatformAdminGuard,
    PlatformTenantService,
    PlatformPlanService,
    PlatformCapabilityService,
    PlatformCommunicationProviderService,
    PlatformGivingProviderService,
    PlatformPaymentProviderService,
    PlatformAnalyticsService,
    PlatformAdminRoleService,
    PlatformAdminManagementService,
    TenantBroadcastService,
    DefaultPlatformAdminSeed,
    PlatformSettingsService,
  ],
  exports: [PlatformSettingsService],
})
export class PlatformAdminModule {}
