import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Tenant } from '../entity/tenant.entity';
import { AppClsStore } from '../interface/tenant-cls-store.interface';
import { runInTenantContext } from './run-in-tenant-context';

export interface TenantLoopResult {
  succeeded: number;
  failed: number;
}

// The @Cron() counterpart to runInTenantContext — a scheduler fires with no
// tenant context at all (no request, no job envelope), so unlike a Bull job
// it has no single tenant to re-enter; it has to loop every active one
// itself. Extracted from BranchRollupScheduler.computeAllRollups(), the one
// scheduler in this codebase that already did this correctly, so the other
// ~20 that were querying tenant-scoped repos with no context (silently
// falling back to the public-schema copy of those tables) get the same
// proven loop instead of each hand-rolling it. One tenant failing doesn't
// stop the rest — same "continue past one failure" behavior the original
// had.
export async function forEachActiveTenant(
  tenantRepo: Repository<Tenant>,
  cls: ClsService<AppClsStore>,
  txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  logger: Logger,
  fn: (tenant: Tenant) => Promise<void>,
): Promise<TenantLoopResult> {
  const tenants = await tenantRepo.find({ where: { isActive: true } });
  let failed = 0;

  for (const tenant of tenants) {
    try {
      await runInTenantContext(
        cls,
        txHost,
        { tenantId: tenant.id, schemaName: tenant.schemaName },
        () => fn(tenant),
      );
    } catch (err: any) {
      failed++;
      logger.warn(
        `Failed for tenant "${tenant.subdomain}": ${err?.message ?? err}`,
      );
    }
  }

  return { succeeded: tenants.length - failed, failed };
}
