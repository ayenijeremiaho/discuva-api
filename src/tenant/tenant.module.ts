import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './entity/tenant.entity';
import { TenantMiddleware } from './middleware/tenant.middleware';
import { TenantInfoController } from './controller/tenant-info.controller';
import { SignupController } from './controller/signup.controller';
import { TenantProvisioningService } from './service/tenant-provisioning.service';
import { BranchModule } from '../branch/branch.module';

/**
 * Wired live (§9 Phase 8's "fresh rollout" variant — no existing church's
 * data to migrate, so the only real step was this bridging one). Every
 * request now resolves a tenant from its Host header subdomain and gets
 * its DB work scoped to that tenant's schema via a transactional SET LOCAL
 * search_path — both done directly in TenantMiddleware, not split across a
 * middleware + a separate TenantTransactionInterceptor the way the first
 * version of this was built. That split didn't work: NestJS runs Guards
 * before Interceptors, so a transaction opened at the interceptor layer
 * never covered guard-level DB access (e.g. the local auth strategy's
 * credential lookup during login) — see TenantMiddleware's own doc comment
 * for how this was confirmed and fixed.
 *
 * Excludes are deliberate and each one is load-bearing:
 * - `v1/platform/(.*)` — the platform-admin control plane operates on
 *   `public` tables only and must never be subjected to tenant resolution.
 * - `v1/signup` — provisions a brand-new tenant; by definition there's no
 *   existing tenant row for its subdomain yet, so TenantMiddleware would
 *   always 404 it otherwise.
 * - `v1/integrations/youtube/callback` — called directly by Google's
 *   PubSubHubbub hub, not by any tenant's browser, so there's no Host
 *   header carrying a tenant subdomain at all. YoutubeLiveDetectionService
 *   resolves the owning tenant itself from the channel id in the
 *   notification body and manually enters that tenant's context — the
 *   same reason this route was silently 404ing in production before this
 *   exclude was added (the feature was never configured in any environment
 *   this ran in, so it went unnoticed).
 * - `v1/webhooks/billing` — called directly by Paystack/Flutterwave, same
 *   no-Host-header reasoning as the YouTube callback above.
 *   CheckoutService resolves the owning tenant from its own
 *   BillingCheckoutSession row, not from anything in the webhook payload
 *   (docs/MULTI_TENANT_MIGRATION.md §9 Phase 3) — added proactively this
 *   time, having already been burned once by forgetting it for YouTube.
 * - `/`, `docs`, `health` — @Version(VERSION_NEUTRAL) routes in
 *   AppController, hit by infra health checks against the bare host with
 *   no tenant subdomain at all — no `v1/` prefix on these specifically
 *   because VERSION_NEUTRAL means they're registered without one.
 *
 * The `v1/` prefix matters and isn't optional: NestJS's URI versioning adds
 * it to the routes it registers, but middleware exclude patterns match the
 * raw incoming request path, which includes it. Confirmed empirically —
 * `platform/(.*)` (no prefix) silently failed to exclude
 * `/v1/platform/auth/login`, 404ing it exactly like a real tenant route.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Tenant]), BranchModule],
  controllers: [TenantInfoController, SignupController],
  providers: [TenantMiddleware, TenantProvisioningService],
  exports: [TenantMiddleware, TenantProvisioningService],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(TenantMiddleware)
      .exclude(
        { path: 'v1/platform/(.*)', method: RequestMethod.ALL },
        { path: 'v1/signup', method: RequestMethod.ALL },
        { path: 'v1/integrations/youtube/callback', method: RequestMethod.ALL },
        { path: 'v1/webhooks/billing', method: RequestMethod.ALL },
        { path: '/', method: RequestMethod.GET },
        { path: 'docs', method: RequestMethod.GET },
        { path: 'health', method: RequestMethod.GET },
      )
      .forRoutes('*');
  }
}
