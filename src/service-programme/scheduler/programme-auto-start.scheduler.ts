import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { ServiceProgramme } from '../entity/service-programme.entity';
import { ServiceProgrammeStatusEnum } from '../enum/service-programme-status.enum';
import { ServiceSessionService } from '../service/service-session.service';
import { CacheService } from '../../utility/service/cache.service';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { forEachActiveTenant } from '../../tenant/utility/for-each-active-tenant';

const AUTO_START_LOCK = 'lock:programme-auto-start';

// How far back a slot's startTime can be and still get auto-started.
// Bounded deliberately — with no lower bound this would resurrect every
// DRAFT programme ever forgotten, not just today's. 10 minutes comfortably
// covers this scheduler's own 5-minute cadence plus one missed run, while
// keeping "auto-started" feeling like it actually happened on time.
const LOOKBACK_MINUTES = 10;

@Injectable()
export class ProgrammeAutoStartScheduler {
  private readonly logger = new Logger(ProgrammeAutoStartScheduler.name);

  constructor(
    @InjectRepository(ServiceProgramme)
    private readonly programmeRepo: Repository<ServiceProgramme>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly sessionService: ServiceSessionService,
    private readonly cacheService: CacheService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  @Cron('*/5 * * * *')
  async autoStartDueProgrammes(): Promise<void> {
    const acquired = await this.cacheService.acquireLock(AUTO_START_LOCK, 270);
    if (!acquired) {
      this.logger.debug(
        'Programme auto-start run skipped — another instance holds the lock',
      );
      return;
    }
    try {
      await forEachActiveTenant(
        this.tenantRepo,
        this.cls,
        this.txHost,
        this.logger,
        () => this.runAutoStart(),
      );
    } finally {
      this.cacheService.releaseLock(AUTO_START_LOCK);
    }
  }

  private async runAutoStart(): Promise<void> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - LOOKBACK_MINUTES * 60 * 1000);

    const programmes = await this.programmeRepo
      .createQueryBuilder('programme')
      .innerJoinAndSelect('programme.serviceSlot', 'slot')
      .innerJoinAndSelect('slot.config', 'config')
      .innerJoinAndSelect('slot.event', 'event')
      .where('programme.status = :status', {
        status: ServiceProgrammeStatusEnum.DRAFT,
      })
      .andWhere('config.auto_start_session = true')
      .andWhere('slot.start_time BETWEEN :windowStart AND :now', {
        windowStart,
        now,
      })
      .getMany();

    if (!programmes.length) return;

    // Several DRAFT programmes in this batch can belong to the same
    // multi-slot event (e.g. First and Second Service both due) —
    // startEvent() already resolves "the correct next one" and guards
    // against a second concurrently-LIVE session for the event, so each
    // distinct event only needs to be started once.
    const eventIds = [
      ...new Set(programmes.map((p) => p.serviceSlot.event.id)),
    ];

    for (const eventId of eventIds) {
      try {
        const session = await this.sessionService.startEvent(eventId, null);
        this.logger.log(
          `Auto-started service session ${session.sessionCode} for event ${eventId}`,
        );
      } catch (err) {
        // A second due slot for an event just auto-started by this same
        // run hits the existing "still live" guard — expected, not an
        // error. Anything else (e.g. a programme with no slots) is logged
        // and skipped so one bad event doesn't block the rest of the batch.
        if (err instanceof ConflictException) continue;
        this.logger.error(
          `Failed to auto-start event ${eventId}: ${(err as Error).message}`,
        );
      }
    }
  }
}
