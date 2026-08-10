import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UtilityModule } from '../utility/utility.module';
import { Plan } from './entity/plan.entity';
import { Subscription } from './entity/subscription.entity';
import { BillingCheckoutSession } from './entity/billing-checkout-session.entity';
import { FeatureUsage } from './entity/feature-usage.entity';
import { PlanGuard } from './guard/plan.guard';
import { PaystackPaymentProvider } from './provider/paystack-payment.provider';
import { FlutterwavePaymentProvider } from './provider/flutterwave-payment.provider';
import { KoraPaymentProvider } from './provider/kora-payment.provider';
import { PaymentProviderRegistryService } from './service/payment-provider-registry.service';
import { CheckoutService } from './service/checkout.service';
import { FeatureUsageService } from './service/feature-usage.service';
import { BillingController } from './controller/billing.controller';
import { BillingWebhookController } from './controller/billing-webhook.controller';
import { SubscriptionLapseScheduler } from './scheduler/subscription-lapse.scheduler';
import { Tenant } from '../tenant/entity/tenant.entity';

// Global, like AdminModule — PlanGuard is used via @UseGuards(PlanGuard) in
// controllers across many feature modules, the same cross-cutting shape as
// AdminGuard (docs/MULTI_TENANT_MIGRATION.md §4.11).
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Plan,
      Subscription,
      BillingCheckoutSession,
      FeatureUsage,
      Tenant,
    ]),
    UtilityModule,
  ],
  controllers: [BillingController, BillingWebhookController],
  providers: [
    PlanGuard,
    PaystackPaymentProvider,
    FlutterwavePaymentProvider,
    KoraPaymentProvider,
    PaymentProviderRegistryService,
    CheckoutService,
    FeatureUsageService,
    SubscriptionLapseScheduler,
  ],
  exports: [PlanGuard, TypeOrmModule, CheckoutService, FeatureUsageService],
})
export class BillingModule {}
