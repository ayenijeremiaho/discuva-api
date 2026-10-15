import { ClsStore } from 'nestjs-cls';

// See docs/MULTI_TENANT_MIGRATION.md §4.2. clusterId is carried from day
// one even though every tenant points at 'default' until multi-cluster
// work (§12) is real — cheap to carry now, expensive to backfill later.
export interface AppClsStore extends ClsStore {
  tenantId: string;
  schemaName: string;
  clusterId: string;
  // Tasks to run once the tenant transaction commits (see utility/after-commit.ts).
  afterCommit?: Array<() => unknown>;
  // Tasks to run in a fresh transaction after the request's transaction rolls back.
  afterRollback?: Array<() => unknown>;
}
