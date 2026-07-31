import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './entity/tenant.entity';
import { TenantMiddleware } from './middleware/tenant.middleware';
import { TenantInfoController } from './controller/tenant-info.controller';

/**
 * Scaffolding only — deliberately NOT imported into AppModule yet.
 *
 * Wiring TenantMiddleware into the live request pipeline today would break
 * every existing request: there is no row in `tenants` matching the current
 * single-tenant deployment's hostname, so every request would immediately
 * 404 with "Tenant not found". This needs a bridging step first — either
 * registering today's deployment as tenant 1 (bringing forward part of
 * MULTI_TENANT_MIGRATION.md §8's "Existing Client Migration"), or deciding
 * dev/staging environments get a wildcard bypass. Not decided yet.
 *
 * TenantTransactionInterceptor (§4.4) has the same "not yet safe to enable"
 * status, for a related reason: it only activates when CLS has a
 * schemaName, which nothing sets until TenantMiddleware runs — so wiring
 * one without the other is a no-op today regardless.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Tenant])],
  controllers: [TenantInfoController],
  providers: [TenantMiddleware],
  exports: [TenantMiddleware],
})
export class TenantModule implements NestModule {
  configure(_consumer: MiddlewareConsumer): void {
    // Deliberately empty — see class-level doc comment. When this is ready:
    //   consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
