import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Tenant } from '../entity/tenant.entity';
import { AppClsStore } from '../interface/tenant-cls-store.interface';
import { CacheService } from '../../utility/service/cache.service';
import { runInTenantContext } from '../utility/run-in-tenant-context';

// Frequent background jobs that can skip a church until their next piece of work is due.
export type GatedJob =
  | 'programme-auto-start'
  | 'absence-marking'
  | 'rental-status'
  | 'event-reminders'
  | 'class-session-reminders';

export const ALL_GATED_JOBS: GatedJob[] = [
  'programme-auto-start',
  'absence-marking',
  'rental-status',
  'event-reminders',
  'class-session-reminders',
];

export type ActiveTenant = Pick<
  Tenant,
  'id' | 'schemaName' | 'subdomain' | 'timezone'
>;

const TENANTS_KEY = 'scheduler:active-tenants';
const TENANTS_TTL_SECONDS = 600;
const HOUR_MS = 3_600_000;
const nextDueKey = (job: GatedJob, tenantId: string) =>
  `scheduler:next-due:${job}:${tenantId}`;
const wokenKey = (job: GatedJob, tenantId: string) =>
  `scheduler:woken:${job}:${tenantId}`;

export interface GatedRunResult {
  succeeded: number;
  failed: number;
  skipped: number;
}

/**
 * Lets the database scale to zero when nothing is due: each gated job records, per church, when its next work is due
 * (in Redis), and later runs skip that church — without opening a database transaction — until then. Any write to the
 * data a job depends on clears the marker (SchedulerGateSubscriber), and no church sleeps past the top of the next hour,
 * so a missed wake-up can delay work by at most an hour and every job wakes the database at the same tick.
 */
@Injectable()
export class SchedulerGateService {
  private readonly logger = new Logger(SchedulerGateService.name);

  constructor(
    private readonly cacheService: CacheService,
    private readonly cls: ClsService<AppClsStore>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  async activeTenants(): Promise<ActiveTenant[]> {
    try {
      const cached =
        await this.cacheService.getGlobal<ActiveTenant[]>(TENANTS_KEY);
      if (cached) return cached;
    } catch {
      // Redis unavailable: fall through to the database
    }
    const tenants = await this.tenantRepo.find({
      where: { isActive: true },
      select: { id: true, schemaName: true, subdomain: true, timezone: true },
    });
    const list = tenants.map(({ id, schemaName, subdomain, timezone }) => ({
      id,
      schemaName,
      subdomain,
      timezone,
    }));
    this.cacheService
      .setGlobal(TENANTS_KEY, list, TENANTS_TTL_SECONDS)
      .catch(() => undefined);
    return list;
  }

  invalidateTenants(): void {
    this.cacheService.delGlobal(TENANTS_KEY).catch(() => undefined);
  }

  // When in doubt (no marker, Redis error) the job runs.
  async shouldRun(
    job: GatedJob,
    tenantId: string,
    now = new Date(),
  ): Promise<boolean> {
    try {
      const due = await this.cacheService.getGlobal<number>(
        nextDueKey(job, tenantId),
      );
      return due === undefined || now.getTime() >= due;
    } catch {
      return true;
    }
  }

  // Records when this church next needs the job. Null = nothing known; capped to the top of the next hour either way.
  // Skipped if the data changed while the job was running, so a concurrent write is never slept through.
  async sleepUntil(
    job: GatedJob,
    tenantId: string,
    nextDue: Date | null,
    startedAt: Date,
    now = new Date(),
  ): Promise<void> {
    try {
      const woken = await this.cacheService.getGlobal<number>(
        wokenKey(job, tenantId),
      );
      if (woken !== undefined && woken >= startedAt.getTime()) {
        await this.cacheService.delGlobal(nextDueKey(job, tenantId));
        return;
      }
      const cap = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS + HOUR_MS;
      const at = Math.min(nextDue ? nextDue.getTime() : Infinity, cap);
      if (at <= now.getTime()) {
        await this.cacheService.delGlobal(nextDueKey(job, tenantId));
        return;
      }
      await this.cacheService.setGlobal(
        nextDueKey(job, tenantId),
        at,
        Math.ceil((at - now.getTime()) / 1000) + 60,
      );
    } catch (err) {
      this.logger.warn(
        `Could not record next run for ${job}/${tenantId}: ${(err as Error).message}`,
      );
    }
  }

  // Called when data a job depends on changes; defaults to the church in the current request.
  async wake(jobs: GatedJob[], tenantId?: string): Promise<void> {
    const id = tenantId ?? this.cls.get('tenantId');
    if (!id || !jobs.length) return;
    const now = Date.now();
    await Promise.all(
      jobs.flatMap((job) => [
        this.cacheService.setGlobal(wokenKey(job, id), now, 2 * 3600),
        this.cacheService.delGlobal(nextDueKey(job, id)),
      ]),
    ).catch((err: Error) =>
      this.logger.warn(`Could not wake ${jobs.join(',')}: ${err.message}`),
    );
  }

  // forEachActiveTenant, but skipping churches with nothing due (no transaction is opened for them).
  // `fn` returns when that church next needs the job (null if nothing is scheduled).
  async forEachDueTenant(
    job: GatedJob,
    txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    logger: Logger,
    fn: () => Promise<Date | null>,
  ): Promise<GatedRunResult> {
    const tenants = await this.activeTenants();
    const result: GatedRunResult = { succeeded: 0, failed: 0, skipped: 0 };
    for (const tenant of tenants) {
      if (!(await this.shouldRun(job, tenant.id))) {
        result.skipped++;
        continue;
      }
      const startedAt = new Date();
      try {
        const nextDue = await runInTenantContext(
          this.cls,
          txHost,
          { tenantId: tenant.id, schemaName: tenant.schemaName },
          fn,
        );
        await this.sleepUntil(job, tenant.id, nextDue, startedAt);
        result.succeeded++;
      } catch (err) {
        result.failed++;
        logger.warn(
          `Failed for tenant "${tenant.subdomain}": ${(err as Error)?.message ?? err}`,
        );
      }
    }
    return result;
  }
}
