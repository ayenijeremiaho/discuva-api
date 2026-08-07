import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { AttendanceService } from '../service/attendance.service';
import { CacheService } from '../../utility/service/cache.service';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { forEachActiveTenant } from '../../tenant/utility/for-each-active-tenant';

const LOCK_KEY = 'lock:absence-marking';
const LOCK_TTL_SECONDS = 270;

@Injectable()
export class AttendanceJobService {
  private readonly logger = new Logger(AttendanceJobService.name);

  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly cacheService: CacheService,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduledMarkAbsentees(): Promise<void> {
    const acquired = await this.cacheService.acquireLock(
      LOCK_KEY,
      LOCK_TTL_SECONDS,
    );
    if (!acquired) {
      this.logger.debug(
        'Absence marking skipped — another instance holds the lock',
      );
      return;
    }
    try {
      const { succeeded, failed } = await forEachActiveTenant(
        this.tenantRepo,
        this.cls,
        this.txHost,
        this.logger,
        () => this.attendanceService.markAbsentees(),
      );
      this.logger.log(
        `Absence marking complete for ${succeeded} tenant(s), ${failed} failure(s)`,
      );
    } finally {
      this.cacheService.releaseLock(LOCK_KEY);
    }
  }
}
