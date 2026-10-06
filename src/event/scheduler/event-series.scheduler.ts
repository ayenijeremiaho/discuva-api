import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { ConfigService } from '@nestjs/config';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { EventSeries } from '../entity/event-series.entity';
import {
  EventSeriesService,
  SERIES_HORIZON_DAYS,
} from '../service/event-series.service';
import { addDays, localDate } from '../types/slot-blueprint';
import { CacheService } from '../../utility/service/cache.service';
import { CHURCH_TIMEZONE } from '../../utility/constants/app.constants';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { forEachActiveTenant } from '../../tenant/utility/for-each-active-tenant';

const LOCK = 'lock:event-series-top-up';

// Keeps every ongoing recurring service created 8 weeks ahead.
@Injectable()
export class EventSeriesScheduler {
  private readonly logger = new Logger(EventSeriesScheduler.name);

  constructor(
    @InjectRepository(EventSeries)
    private readonly seriesRepo: Repository<EventSeries>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly seriesService: EventSeriesService,
    private readonly cacheService: CacheService,
    private readonly config: ConfigService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  @Cron('0 2 * * *', { timeZone: CHURCH_TIMEZONE })
  async topUp(): Promise<void> {
    const acquired = await this.cacheService.acquireLock(LOCK, 1800);
    if (!acquired) {
      this.logger.debug(
        'Series top-up skipped — another instance holds the lock',
      );
      return;
    }
    try {
      await forEachActiveTenant(
        this.tenantRepo,
        this.cls,
        this.txHost,
        this.logger,
        (tenant) => this.topUpTenant(tenant.timezone || this.fallbackTimezone),
      );
    } finally {
      this.cacheService.releaseLock(LOCK);
    }
  }

  private get fallbackTimezone(): string {
    return this.config.get<string>('TIMEZONE') || CHURCH_TIMEZONE;
  }

  private async topUpTenant(timezone: string): Promise<void> {
    const horizon = addDays(
      localDate(new Date(), timezone),
      SERIES_HORIZON_DAYS,
    );
    // Only series that can still gain a date — finished fixed-end ones aren't reloaded nightly.
    const series = await this.seriesRepo
      .createQueryBuilder('s')
      .where('s.is_active')
      .andWhere(
        '(s.generated_through IS NULL OR (s.generated_through < :horizon AND (s.end_date IS NULL OR s.end_date > s.generated_through)))',
        { horizon },
      )
      .getMany();
    for (const s of series) {
      try {
        await this.seriesService.generate(s, timezone);
      } catch (err) {
        this.logger.warn(
          `Series ${s.id} top-up failed: ${(err as Error).message}`,
        );
      }
    }
  }
}
