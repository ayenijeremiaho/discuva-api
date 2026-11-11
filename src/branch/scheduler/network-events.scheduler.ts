import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { CacheService } from '../../utility/service/cache.service';
import { NetworkShareService } from '../../network-share/network-share.service';
import { CHURCH_TIMEZONE } from '../../utility/constants/app.constants';

const LOCK = 'lock:network-events-nightly';

// Once a night, churches in a network re-copy their events: past ones age out, and series dates added overnight appear.
@Injectable()
export class NetworkEventsScheduler {
  private readonly logger = new Logger(NetworkEventsScheduler.name);

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly cache: CacheService,
    private readonly share: NetworkShareService,
  ) {}

  @Cron('30 3 * * *', { timeZone: CHURCH_TIMEZONE })
  async refreshAll(): Promise<void> {
    if (!(await this.cache.acquireLock(LOCK, 900))) return;
    try {
      const tenants = await this.tenantRepo.find({
        where: { networkRootId: Not(IsNull()), isActive: true },
        select: { id: true },
      });
      for (const t of tenants) await this.share.queueEventsCopy(t.id);
      if (tenants.length)
        this.logger.log(
          `Queued network event copies for ${tenants.length} church(es)`,
        );
    } finally {
      this.cache.releaseLock(LOCK);
    }
  }
}
