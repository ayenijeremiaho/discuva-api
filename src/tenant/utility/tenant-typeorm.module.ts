import { DynamicModule, Module, Provider } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
// Not re-exported from '@nestjs/typeorm's package root (only from its
// internal interfaces/ barrel) despite being the param type of
// getRepositoryToken() itself — imported from its real path instead of
// widening this module's signature to `Function | string`.
import { EntityClassOrSchema } from '@nestjs/typeorm/dist/interfaces/entity-class-or-schema.type';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';

// @nestjs-cls/transactional-adapter-typeorm does NOT patch DataSource#manager
// or anything a plain @InjectRepository() resolves to — confirmed by reading
// its source (transactional-adapter-typeorm.js): it only exposes the active
// transaction's EntityManager via TransactionHost#tx for code that explicitly
// asks for it. TypeORM's own Repository captures `manager` once, as a plain
// constructor property (Repository.js), not a live getter — so a repository
// created via the standard `@InjectRepository(Entity)` token is permanently
// bound to the app-wide default manager and can NEVER see a per-request
// tenant transaction, no matter where or how that transaction was opened.
// This was discovered live: TenantMiddleware correctly ran `SET LOCAL
// search_path` before AuthService's login lookup, but MemberService's
// standard @InjectRepository(Member) still queried `public` and missed a row
// that was verifiably sitting in the tenant's schema (docs/MULTI_TENANT_MIGRATION.md
// §4.5 has the full writeup).
//
// This module provides a drop-in replacement for TypeOrmModule.forFeature():
// same `getRepositoryToken(Entity)` DI token, so every existing
// `@InjectRepository(Entity)` call site keeps working unmodified. The
// provider itself is a Proxy that re-resolves `txHost.tx.getRepository(Entity)`
// on every property access rather than once at construction time — `tx`
// returns the CLS-scoped transactional EntityManager when TenantMiddleware
// has one open, or the fallback (default, `public`-search-path) manager
// otherwise, so this is correct for both tenant-scoped and tenant-excluded
// routes without the call site needing to know which one it's in.
function tenantRepositoryProvider(entity: EntityClassOrSchema): Provider {
  return {
    provide: getRepositoryToken(entity),
    useFactory: (txHost: TransactionHost<TransactionalAdapterTypeOrm>) =>
      new Proxy(
        {},
        {
          get(_target, prop, _receiver) {
            const repo = txHost.tx.getRepository(entity);
            const value = Reflect.get(repo, prop, repo);
            return typeof value === 'function' ? value.bind(repo) : value;
          },
        },
      ),
    inject: [TransactionHost],
  };
}

@Module({})
export class TenantTypeOrmModule {
  static forFeature(entities: EntityClassOrSchema[]): DynamicModule {
    const providers = entities.map(tenantRepositoryProvider);
    return {
      module: TenantTypeOrmModule,
      providers,
      exports: providers,
    };
  }
}
