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
import { DateService } from '../../utility/service/date.service';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { forEachActiveTenant } from '../../tenant/utility/for-each-active-tenant';

const AUTO_START_LOCK = 'lock:programme-auto-start';

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
    private readonly dateService: DateService,
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
    // Bounded to "today" (church-local), not a short trailing window — a
    // later slot in a multi-slot event (e.g. Second Service) only becomes
    // startable once the prior slot's session is ended, which a front-desk
    // worker might do well after the slot's own nominal startTime. A tight
    // lookback (this used to be 10 minutes) would then permanently strand
    // it in DRAFT, since by the time it's finally unblocked its startTime
    // has already scrolled out of the window. Anchoring to start-of-day
    // still prevents resurrecting a DRAFT programme genuinely forgotten
    // from a previous day.
    const windowStart = this.dateService.startOfDay(now);

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
    // multi-slot event (e.g. First and Second Service both due) — group by
    // event and only start the earliest-due one per event; a second due
    // slot for the same event on this run (or a later run) gets picked up
    // once the first has ended, same as the manual "Start" button's own
    // one-slot-at-a-time behavior. Passing that specific programme's id to
    // startEvent() (rather than leaving it to fall back to "earliest DRAFT
    // for the whole event") matters: this batch is already filtered to
    // DRAFT + auto_start_session=true + due-within-window, so it can
    // correctly skip over an *earlier*, still-DRAFT sibling slot that was
    // deliberately left for a manual start (auto_start_session=false, or
    // just not due yet) instead of mistakenly starting that one.
    const dueProgrammeIdByEvent = new Map<string, string>();
    const dueStartTimeByEvent = new Map<string, number>();
    for (const programme of programmes) {
      const eventId = programme.serviceSlot.event.id;
      const startMs = programme.serviceSlot.startTime.getTime();
      const earliestSoFar = dueStartTimeByEvent.get(eventId);
      if (earliestSoFar === undefined || startMs < earliestSoFar) {
        dueStartTimeByEvent.set(eventId, startMs);
        dueProgrammeIdByEvent.set(eventId, programme.id);
      }
    }

    for (const [eventId, programmeId] of dueProgrammeIdByEvent) {
      try {
        const session = await this.sessionService.startEvent(
          eventId,
          null,
          programmeId,
        );
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
