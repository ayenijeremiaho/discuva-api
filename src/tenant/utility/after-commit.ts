import { Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { AppClsStore } from '../interface/tenant-cls-store.interface';

const logger = new Logger('AfterCommit');

// Runs `fn` once the current tenant transaction has committed (dropped on rollback). Outside a
// tenant transaction (no queue in context) it runs straight away.
export function afterCommit(
  cls: ClsService<AppClsStore>,
  fn: () => unknown,
): void {
  const queue = cls.isActive() ? cls.get('afterCommit') : undefined;
  if (queue) queue.push(fn);
  else void Promise.resolve().then(fn);
}

// Called by the transaction wrappers after a successful commit, still inside the tenant context.
export async function flushAfterCommit(
  cls: ClsService<AppClsStore>,
): Promise<void> {
  const queue = cls.get('afterCommit');
  if (!Array.isArray(queue) || queue.length === 0) return;
  cls.set('afterCommit', []);
  for (const fn of queue) {
    try {
      await fn();
    } catch (err) {
      logger.warn(
        `After-commit task failed: ${(err as Error)?.message ?? err}`,
      );
    }
  }
}

// Runs `fn` after the current tenant transaction rolls back (a request that ended in an error), in a fresh
// transaction of its own — for records that must outlive the rejection, e.g. a blocked check-in.
// Outside a tenant transaction nothing rolls back, so it runs straight away.
export function afterRollback(
  cls: ClsService<AppClsStore>,
  fn: () => unknown,
): void {
  const queue = cls.isActive() ? cls.get('afterRollback') : undefined;
  if (queue) queue.push(fn);
  else void Promise.resolve().then(fn);
}

// Called by TenantMiddleware once the request's own transaction has rolled back and released its connection.
export async function flushAfterRollback(
  cls: ClsService<AppClsStore>,
  txHost: TransactionHost<TransactionalAdapterTypeOrm>,
): Promise<void> {
  const queue = cls.get('afterRollback');
  if (!Array.isArray(queue) || queue.length === 0) return;
  cls.set('afterRollback', []);
  const schemaName = cls.get('schemaName');
  for (const fn of queue) {
    try {
      await cls.runWith(
        { tenantId: cls.get('tenantId'), schemaName } as AppClsStore,
        () =>
          txHost.withTransaction(async () => {
            await txHost.tx.query(
              `SET LOCAL search_path TO "${schemaName}", public`,
            );
            await fn();
          }),
      );
    } catch (err) {
      logger.warn(
        `After-rollback task failed: ${(err as Error)?.message ?? err}`,
      );
    }
  }
}
