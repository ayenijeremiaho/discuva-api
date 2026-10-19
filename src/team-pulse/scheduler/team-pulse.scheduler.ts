import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { SchedulerGateService } from '../../tenant/scheduler-gate/scheduler-gate.service';
import { CacheService } from '../../utility/service/cache.service';
import { ChurchSettingsService } from '../../church-settings/service/church-settings.service';
import { TeamPulseService } from '../service/team-pulse.service';

// Opens recurring check-ins when due and reminds people the day before a required one closes.
@Injectable()
export class TeamPulseScheduler {
  private static readonly LOCK_KEY = 'lock:team-pulse';
  private readonly logger = new Logger(TeamPulseScheduler.name);

  constructor(
    private readonly gate: SchedulerGateService,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly cacheService: CacheService,
    private readonly churchSettings: ChurchSettingsService,
    private readonly pulses: TeamPulseService,
  ) {}

  @Cron('*/15 * * * *')
  async run(): Promise<void> {
    if (
      !(await this.cacheService.acquireLock(TeamPulseScheduler.LOCK_KEY, 600))
    )
      return;
    try {
      await this.gate.forEachDueTenant(
        'team-pulse',
        this.txHost,
        this.logger,
        async () =>
          (await this.churchSettings.isEnabled('team_pulse'))
            ? this.pulses.runDue()
            : null,
      );
    } finally {
      this.cacheService.releaseLock(TeamPulseScheduler.LOCK_KEY);
    }
  }
}
