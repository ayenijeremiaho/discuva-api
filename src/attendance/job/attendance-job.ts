import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { AttendanceService } from '../service/attendance.service';
import { CacheService } from '../../utility/service/cache.service';
import { SchedulerGateService } from '../../tenant/scheduler-gate/scheduler-gate.service';

const LOCK_KEY = 'lock:absence-marking';
const LOCK_TTL_SECONDS = 270;

@Injectable()
export class AttendanceJobService {
  private readonly logger = new Logger(AttendanceJobService.name);

  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly cacheService: CacheService,
    private readonly gate: SchedulerGateService,
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
      const { succeeded, failed, skipped } = await this.gate.forEachDueTenant(
        'absence-marking',
        this.txHost,
        this.logger,
        async () => {
          await this.attendanceService.markAbsentees();
          return this.attendanceService.nextAbsenceMarkingDue();
        },
      );
      if (succeeded || failed)
        this.logger.log(
          `Absence marking complete for ${succeeded} tenant(s), ${failed} failure(s), ${skipped} with nothing due`,
        );
    } finally {
      this.cacheService.releaseLock(LOCK_KEY);
    }
  }
}
