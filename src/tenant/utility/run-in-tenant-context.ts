import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { AppClsStore } from '../interface/tenant-cls-store.interface';
import { TenantJobEnvelope } from './job-envelope';

const VALID_SCHEMA_NAME = /^[a-z_][a-z0-9_]*$/;

// Bull processor counterpart to TenantMiddleware's own transaction wrapping
// (§4.4): a job runs on a worker process with no CLS context of its own,
// potentially long after the request that enqueued it, so tenant context
// has to be re-entered from the envelope carried in job.data rather than
// inherited. Same SET LOCAL-inside-a-transaction mechanism, for the same
// transaction-pooling reason — a plain session-level SET would risk
// leaking across jobs sharing a pooled connection.
//
// Jobs enqueued outside any tenant-scoped request (schedulers/crons, or
// requests to excluded routes like /platform/*) have no schemaName in
// job.data and run exactly as they do without any of this: no transaction
// wrapper, no search_path change.
export async function runInTenantContext<T>(
  cls: ClsService<AppClsStore>,
  txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  envelope: TenantJobEnvelope,
  fn: () => Promise<T>,
): Promise<T> {
  if (!envelope.schemaName) return fn();

  if (!VALID_SCHEMA_NAME.test(envelope.schemaName)) {
    throw new Error('Invalid tenant schema name in job payload');
  }

  return cls.runWith(
    {
      tenantId: envelope.tenantId,
      schemaName: envelope.schemaName,
    } as AppClsStore,
    () =>
      txHost.withTransaction(async () => {
        await txHost.tx.query(
          `SET LOCAL search_path TO "${envelope.schemaName}", public`,
        );
        return fn();
      }),
  );
}
