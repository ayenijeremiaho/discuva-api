import {
  CallHandler,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from, firstValueFrom } from 'rxjs';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../interface/tenant-cls-store.interface';

// Schema names only ever come from TenantProvisioningService (§4.8), never
// directly from a request — but SET LOCAL search_path can't use a
// parameterized placeholder the way a normal query can, so this is a
// defense-in-depth format check, not the primary trust boundary.
const VALID_SCHEMA_NAME = /^[a-z_][a-z0-9_]*$/;

// Not yet wired in (no APP_INTERCEPTOR registration in AppModule) — see
// src/tenant/tenant.module.ts. Wraps the request in one DB transaction and
// scopes search_path to it via SET LOCAL, which is safe under
// PgBouncer/Supavisor transaction-mode pooling (session-level SET is not —
// see docs/MULTI_TENANT_MIGRATION.md §4.4). Routes with no tenant context
// in CLS (e.g. the exempted /platform/* routes) pass through untouched.
@Injectable()
export class TenantTransactionInterceptor implements NestInterceptor {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const schemaName = this.cls.get('schemaName');

    if (!schemaName) {
      return next.handle();
    }

    if (!VALID_SCHEMA_NAME.test(schemaName)) {
      throw new InternalServerErrorException('Invalid tenant schema name');
    }

    return from(
      this.txHost.withTransaction(async () => {
        await this.txHost.tx.query(
          `SET LOCAL search_path TO "${schemaName}", public`,
        );
        return firstValueFrom(next.handle());
      }),
    );
  }
}
