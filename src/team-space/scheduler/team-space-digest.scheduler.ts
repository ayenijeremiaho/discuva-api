import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { SchedulerGateService } from '../../tenant/scheduler-gate/scheduler-gate.service';
import { CacheService } from '../../utility/service/cache.service';
import { ChurchSettingsService } from '../../church-settings/service/church-settings.service';
import { TeamSpaceDigestService } from '../service/team-space-digest.service';

// Hourly, on the same top-of-hour tick as the other gated jobs, so it never wakes the database on its own.
@Injectable()
export class TeamSpaceDigestScheduler {
  private static readonly LOCK_KEY = 'lock:team-space-digest';
  private readonly logger = new Logger(TeamSpaceDigestScheduler.name);

  constructor(
    private readonly gate: SchedulerGateService,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly cacheService: CacheService,
    private readonly churchSettings: ChurchSettingsService,
    private readonly digest: TeamSpaceDigestService,
  ) {}

  @Cron('0 * * * *')
  async run(): Promise<void> {
    if (
      !(await this.cacheService.acquireLock(
        TeamSpaceDigestScheduler.LOCK_KEY,
        1800,
      ))
    )
      return;
    try {
      await this.gate.forEachDueTenant(
        'team-space-digest',
        this.txHost,
        this.logger,
        async () =>
          (await this.churchSettings.isEnabled('team_spaces'))
            ? this.digest.run()
            : null,
      );
    } finally {
      this.cacheService.releaseLock(TeamSpaceDigestScheduler.LOCK_KEY);
    }
  }
}
