import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MemberModule } from '../member/member.module';
import { Tenant } from './entity/tenant.entity';
import { TenantMiddleware } from './middleware/tenant.middleware';
import { TenantInfoController } from './controller/tenant-info.controller';
import { SignupController } from './controller/signup.controller';
import { TenantProvisioningService } from './service/tenant-provisioning.service';

/**
 * Imported into AppModule (for POST /signup and GET /tenant/info) but
 * configure() stays deliberately EMPTY — TenantMiddleware/TenantTransactionInterceptor
 * are not wired into the live request pipeline.
 *
 * Wiring TenantMiddleware globally today would break every existing
 * request: there is no row in `tenants` matching the current single-tenant
 * deployment's hostname, so every request would immediately 404 with
 * "Tenant not found". This needs a bridging step first — either
 * registering today's deployment as tenant 1 (bringing forward part of
 * MULTI_TENANT_MIGRATION.md §8's "Existing Client Migration"), or deciding
 * dev/staging environments get a wildcard bypass. Not decided yet.
 *
 * The module's controllers are safe to live today regardless: GET
 * /tenant/info always 404s (no tenantId ever lands in CLS without the
 * middleware), and POST /signup is genuinely new, self-contained
 * functionality that doesn't touch the existing single-tenant deployment's
 * request path at all — it provisions a brand new schema.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Tenant]), MemberModule],
  controllers: [TenantInfoController, SignupController],
  providers: [TenantMiddleware, TenantProvisioningService],
  exports: [TenantMiddleware, TenantProvisioningService],
})
export class TenantModule implements NestModule {
  configure(_consumer: MiddlewareConsumer): void {
    // Deliberately empty — see class-level doc comment. When this is ready:
    //   consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
