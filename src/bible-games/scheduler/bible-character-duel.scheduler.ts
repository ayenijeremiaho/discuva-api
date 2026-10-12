import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { SchedulerGateService } from '../../tenant/scheduler-gate/scheduler-gate.service';
import { runInTenantContext } from '../../tenant/utility/run-in-tenant-context';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { CacheService } from '../../utility/service/cache.service';
import { BibleCharacterDuelService } from '../service/bible-character-duel.service';

const LOCK = 'lock:bible-character-duels';

// Ends duels whose invite or turn ran out of time, so the winner's points don't wait for someone to open the app.
@Injectable()
export class BibleCharacterDuelScheduler {
  private readonly logger = new Logger(BibleCharacterDuelScheduler.name);

  constructor(
    private readonly gate: SchedulerGateService,
    private readonly cacheService: CacheService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly duels: BibleCharacterDuelService,
  ) {}

  @Cron('20 * * * *')
  async run(): Promise<void> {
    const acquired = await this.cacheService.acquireLock(LOCK, 900);
    if (!acquired) return;
    try {
      for (const tenant of await this.gate.activeTenants()) {
        try {
          await runInTenantContext(
            this.cls,
            this.txHost,
            { tenantId: tenant.id, schemaName: tenant.schemaName },
            () => this.duels.expireOverdue(),
          );
        } catch (err) {
          this.logger.warn(
            `Duel sweep failed for "${tenant.subdomain}": ${(err as Error)?.message ?? err}`,
          );
        }
      }
    } finally {
      this.cacheService.releaseLock(LOCK);
    }
  }
}
