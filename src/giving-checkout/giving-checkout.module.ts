import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { GivingProvider } from './entity/giving-provider.entity';
import { TenantGivingProviderConfig } from './entity/tenant-giving-provider-config.entity';
import { GivingCheckoutSession } from './entity/giving-checkout-session.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { Member } from '../member/entity/member.entity';
import { TitheAccount } from '../tithe/entity/tithe-account.entity';
import { GivingOption } from '../finance/entity/giving-option.entity';
import { Pledge } from '../finance/entity/pledge.entity';
import { PaystackGivingProvider } from './provider/paystack-giving.provider';
import { FlutterwaveGivingProvider } from './provider/flutterwave-giving.provider';
import { KoraGivingProvider } from './provider/kora-giving.provider';
import { StripeGivingProvider } from './provider/stripe-giving.provider';
import { GivingProviderRegistryService } from './service/giving-provider-registry.service';
import { TenantGivingProviderService } from './service/tenant-giving-provider.service';
import { GivingCheckoutService } from './service/giving-checkout.service';
import { TenantGivingProviderController } from './controller/tenant-giving-provider.controller';
import { GivingCheckoutController } from './controller/giving-checkout.controller';
import { GivingWebhookController } from './controller/giving-webhook.controller';
import { UtilityModule } from '../utility/utility.module';
import { AdminModule } from '../admin/admin.module';
import { FinanceModule } from '../finance/finance.module';

// GivingProvider/TenantGivingProviderConfig/GivingCheckoutSession are all
// control-plane (public, never a search_path target) — plain TypeOrmModule,
// same reasoning as CommunicationProviderModule/BillingModule: the giving
// webhook has no tenant (schema) context until GivingCheckoutService
// manually resolves one via Tenant.schemaName + runInTenantContext. Member/
// TitheAccount are tenant-scoped (TenantTypeOrmModule) since
// GivingCheckoutService reads them during the normal in-app checkout
// request, which already has tenant context from TenantMiddleware.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      GivingProvider,
      TenantGivingProviderConfig,
      GivingCheckoutSession,
      Tenant,
    ]),
    TenantTypeOrmModule.forFeature([
      Member,
      TitheAccount,
      GivingOption,
      Pledge,
    ]),
    UtilityModule,
    AdminModule,
    FinanceModule,
  ],
  controllers: [
    TenantGivingProviderController,
    GivingCheckoutController,
    GivingWebhookController,
  ],
  providers: [
    PaystackGivingProvider,
    FlutterwaveGivingProvider,
    KoraGivingProvider,
    StripeGivingProvider,
    GivingProviderRegistryService,
    TenantGivingProviderService,
    GivingCheckoutService,
  ],
})
export class GivingCheckoutModule {}
