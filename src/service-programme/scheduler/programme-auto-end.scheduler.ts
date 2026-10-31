import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Repository } from 'typeorm';
import { ServiceSession } from '../entity/service-session.entity';
import { ServiceSessionService } from '../service/service-session.service';
import { ServiceSessionGateway } from '../gateway/service-session.gateway';
import { CacheService } from '../../utility/service/cache.service';
import { SchedulerGateService } from '../../tenant/scheduler-gate/scheduler-gate.service';
import { ReminderSettingsService } from '../../reminder-settings/service/reminder-settings.service';
import { ReminderSettingKey } from '../../reminder-settings/enum/reminder-setting-key.enum';

const AUTO_END_LOCK = 'lock:programme-auto-end';
const MINUTE_MS = 60_000;
const DEFAULT_MINUTES = 60;
const HOUR_MS = 3_600_000;
const RECHECK_OPEN_SCREEN_MS = 15 * MINUTE_MS;
// A screen left open on a TV mustn't keep a session alive for days.
const OPEN_SCREEN_LIMIT_MS = 12 * HOUR_MS;

// Ends sessions nobody finished. A service running late isn't cut off: the clock counts from the later of its
// planned end and the last action, and waits while a live screen is open. Sleeps until the next one is due.
@Injectable()
export class ProgrammeAutoEndScheduler {
  private readonly logger = new Logger(ProgrammeAutoEndScheduler.name);

  constructor(
    @InjectRepository(ServiceSession)
    private readonly sessionRepo: Repository<ServiceSession>,
    private readonly sessions: ServiceSessionService,
    private readonly gateway: ServiceSessionGateway,
    private readonly settings: ReminderSettingsService,
    private readonly cacheService: CacheService,
    private readonly gate: SchedulerGateService,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  @Cron('*/15 * * * *')
  async endForgottenSessions(): Promise<void> {
    if (!(await this.cacheService.acquireLock(AUTO_END_LOCK, 600))) return;
    try {
      await this.gate.forEachDueTenant(
        'programme-auto-end',
        this.txHost,
        this.logger,
        () => this.runAutoEnd(),
      );
    } finally {
      this.cacheService.releaseLock(AUTO_END_LOCK);
    }
  }

  async runAutoEnd(now = new Date()): Promise<Date | null> {
    const { enabled, thresholds } = await this.settings.getConfig(
      ReminderSettingKey.PROGRAMME_AUTO_END,
    );
    if (!enabled) return null;
    const graceMs = (thresholds[0] ?? DEFAULT_MINUTES) * MINUTE_MS;
    const rows = (await this.sessionRepo.query(
      `SELECT s.session_code, GREATEST(ss.end_time,
         (SELECT max(a.created_at) FROM service_action_entries a WHERE a.session_id = s.id)) AS active_until
       FROM service_sessions s
       JOIN service_programmes p ON p.id = s.programme_id
       JOIN service_slots ss ON ss.id = p.service_slot_id
       WHERE s.status = 'LIVE'`,
    )) as { session_code: string; active_until: Date }[];
    let next: number | null = null;
    for (const row of rows) {
      const endAt = new Date(row.active_until).getTime() + graceMs;
      if (endAt > now.getTime()) {
        next = next === null ? endAt : Math.min(next, endAt);
        continue;
      }
      try {
        const lastActive = new Date(row.active_until).getTime();
        if (
          now.getTime() - lastActive < OPEN_SCREEN_LIMIT_MS &&
          (await this.gateway.hasOpenScreens(row.session_code))
        ) {
          const recheck = now.getTime() + RECHECK_OPEN_SCREEN_MS;
          next = next === null ? recheck : Math.min(next, recheck);
          continue;
        }
        // Dated when it should have ended, so a report doesn't show a service lasting days.
        await this.sessions.end(
          row.session_code,
          null,
          'Ended automatically',
          new Date(endAt),
        );
        this.gateway.broadcastState(
          row.session_code,
          await this.sessions.getState(row.session_code),
        );
        this.logger.log(`Auto-ended forgotten session ${row.session_code}`);
      } catch (err) {
        this.logger.error(
          `Failed to auto-end session ${row.session_code}: ${(err as Error).message}`,
        );
      }
    }
    return next === null ? null : new Date(next);
  }
}
