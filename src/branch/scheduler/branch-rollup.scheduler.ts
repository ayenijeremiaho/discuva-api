import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { CacheService } from '../../utility/service/cache.service';
import { CHURCH_TIMEZONE } from '../../utility/constants/app.constants';
import { BranchRollupService } from '../service/branch-rollup.service';

const ROLLUP_LOCK = 'lock:tenant-rollup-compute';

// Every active tenant gets a rollup computed daily, not just tenants with a
// parent — a branch invited later still needs history to show once linked,
// and it's simpler to compute for everyone than special-case which tenants
// "count" (docs/MULTI_TENANT_MIGRATION.md §11.3). One lock for the whole
// batch, not per-tenant — guards against two app instances both running the
// cron, not against tenants racing each other (same shape as
// YoutubeSubscriptionScheduler).
@Injectable()
export class BranchRollupScheduler {
  private readonly logger = new Logger(BranchRollupScheduler.name);

  constructor(
    private readonly branchRollupService: BranchRollupService,
    private readonly cacheService: CacheService,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  @Cron('0 3 * * *', { timeZone: CHURCH_TIMEZONE })
  async computeAllRollups(): Promise<void> {
    const acquired = await this.cacheService.acquireLock(ROLLUP_LOCK, 1800);
    if (!acquired) {
      this.logger.debug(
        'Tenant rollup computation skipped — another instance holds the lock',
      );
      return;
    }

    const tenants = await this.tenantRepo.find({ where: { isActive: true } });
    let failures = 0;
    for (const tenant of tenants) {
      try {
        await this.branchRollupService.computeAndUpsertOne(tenant);
      } catch (err: any) {
        failures++;
        this.logger.warn(
          `Rollup computation failed for tenant "${tenant.subdomain}": ${err?.message ?? err}`,
        );
      }
    }
    this.logger.log(
      `Computed rollups for ${tenants.length - failures}/${tenants.length} active tenant(s)`,
    );
  }
}
