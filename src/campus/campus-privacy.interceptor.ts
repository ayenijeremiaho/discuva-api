import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { DataSource } from 'typeorm';
import { Observable, from, mergeMap } from 'rxjs';
import { AppClsStore } from '../tenant/interface/tenant-cls-store.interface';
import { queryTenant } from '../tenant/utility/query-tenant';
import { campusScopeOf, maskPeople, personIds } from './campus-scope';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Every response to an admin who looks after particular campuses passes through here, so a person from
// another campus shows by name and photo only, whichever screen or module returned them.
@Injectable()
export class CampusPrivacyInterceptor implements NestInterceptor {
  constructor(
    private readonly dataSource: DataSource,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const self: string | undefined = context.switchToHttp().getRequest()
      ?.user?.id;
    return next.handle().pipe(
      mergeMap((body) => {
        const scope = campusScopeOf(this.cls);
        if (!scope) return [body];
        return from(this.mask(body, scope, self));
      }),
    );
  }

  private async mask(
    body: unknown,
    scope: string[],
    self?: string,
  ): Promise<unknown> {
    // An admin always sees themselves in full.
    const ids = [...personIds(body)].filter(
      (id) => UUID.test(id) && id !== self,
    );
    if (!ids.length) return body;
    // Schema-qualified: the request's own transaction may already be closing.
    const rows = await queryTenant<{ id: string }>(
      this.dataSource,
      this.cls.get('schemaName'),
      (schema) =>
        `SELECT id FROM ${schema}.members
          WHERE id = ANY($1::uuid[])
            AND home_campus_id IS NOT NULL
            AND NOT (home_campus_id = ANY($2::uuid[]))`,
      [ids, scope],
    );
    maskPeople(body, new Set(rows.map((r) => r.id)));
    return body;
  }
}
