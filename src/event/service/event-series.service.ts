import { EventAudienceEnum } from '../enums/event-audience.enum';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, MoreThanOrEqual, Repository } from 'typeorm';
import { EventSeries } from '../entity/event-series.entity';
import { Event } from '../entity/event.entity';
import { Member } from '../../member/entity/member.entity';
import { CreateEventDto } from '../dto/create-event.dto';
import { UpdateEventSeriesDto } from '../dto/event-series.dto';
import { EventRecurrencePatternEnum } from '../enums/event-recurrence-patterns.enums';
import { EventService } from './event.service';
import { ChurchTimezoneService } from './church-timezone.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import {
  SlotBlueprint,
  addDays,
  addMonths,
  blueprintToSlotDtos,
  localDate,
  slotDtosToBlueprint,
} from '../types/slot-blueprint';

export const SERIES_HORIZON_DAYS = 56;
const MAX_OCCURRENCES = 1000;

export interface SeriesSummary {
  id: string;
  name: string;
  recurrencePattern: EventRecurrencePatternEnum;
  recurrenceInterval: number;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  autoProgramme: boolean;
  slotBlueprint: SlotBlueprint[];
  nextOccurrence: Date | null;
  upcomingCount: number;
}

export interface SeriesUpdateResult {
  updated: number;
  recreated: number;
  skippedWithHistory: number;
}

const slotNames = (names: string[]) =>
  [...names]
    .map((n) => n.trim().toLowerCase())
    .sort()
    .join('|');

// The repeat rule behind recurring events: creates occurrences ahead of time and keeps them in step when it changes.
@Injectable()
export class EventSeriesService {
  private readonly logger = new Logger(EventSeriesService.name);

  constructor(
    @InjectRepository(EventSeries)
    private readonly seriesRepo: Repository<EventSeries>,
    @InjectRepository(Event)
    private readonly eventRepo: Repository<Event>,
    @Inject(forwardRef(() => EventService))
    private readonly eventService: EventService,
    private readonly churchTimezone: ChurchTimezoneService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async createFromEvent(
    dto: CreateEventDto,
    actorId: string,
  ): Promise<Event[]> {
    const recurrence = dto.recurrence!;
    const timezone = await this.churchTimezone.get();
    const { date, blueprint } = slotDtosToBlueprint(dto.serviceSlots, timezone);

    const endDate = recurrence.ongoing ? null : recurrence.recurrenceEndDate!;
    if (endDate) {
      if (endDate < date) {
        throw new BadRequestException(
          'Recurrence end date must be on or after the first service',
        );
      }
      if (endDate > addDays(date, 366)) {
        throw new BadRequestException(
          'Recurrence end date must be within one year of event start',
        );
      }
    }

    const series = await this.seriesRepo.save(
      this.seriesRepo.create({
        name: dto.name,
        description: dto.description ?? null,
        onlineAttendanceEnabled: dto.onlineAttendanceEnabled ?? false,
        recurrencePattern: recurrence.recurrencePattern,
        recurrenceInterval: recurrence.recurrenceInterval,
        startDate: date,
        endDate,
        slotBlueprint: blueprint,
        autoProgramme: dto.autoProgramme ?? true,
        audience: dto.audience ?? EventAudienceEnum.EVERYONE,
        audienceGroupId: dto.audienceGroupId ?? null,
        createdBy: { id: actorId } as Member,
      }),
    );
    // A fixed end date is created in full, as before; an ongoing series is topped up nightly.
    const until = endDate ?? undefined;
    return this.generate(series, timezone, new Date(), until);
  }

  occurrenceDates(series: EventSeries, until: string): string[] {
    const dates: string[] = [];
    const step = series.recurrenceInterval;
    for (let k = 0; k < MAX_OCCURRENCES; k++) {
      let date: string;
      if (series.recurrencePattern === EventRecurrencePatternEnum.MONTHLY) {
        date = addMonths(series.startDate, k * step);
      } else if (
        series.recurrencePattern === EventRecurrencePatternEnum.WEEKLY
      ) {
        date = addDays(series.startDate, k * step * 7);
      } else {
        date = addDays(series.startDate, k * step);
      }
      if (date > until || (series.endDate && date > series.endDate)) break;
      dates.push(date);
    }
    return dates;
  }

  // Creates any occurrences missing up to the horizon (or `until`); dates at or before generatedThrough are never revisited.
  async generate(
    series: EventSeries,
    timezone: string,
    now = new Date(),
    until?: string,
  ): Promise<Event[]> {
    const horizon =
      until ?? addDays(localDate(now, timezone), SERIES_HORIZON_DAYS);
    const dates = this.occurrenceDates(series, horizon).filter(
      (d) => !series.generatedThrough || d > series.generatedThrough,
    );
    if (!dates.length) return [];

    const created: Event[] = [];
    for (const date of dates) {
      const slotDtos = blueprintToSlotDtos(
        series.slotBlueprint,
        date,
        timezone,
      );
      if (slotDtos.some((s) => Date.parse(s.startTime) <= now.getTime()))
        continue;
      const exists = await this.eventRepo.existsBy({
        recurringEventId: series.id,
        seriesOccurrenceDate: date,
      });
      if (exists) continue;
      const saved = await this.createOccurrence(series, date, slotDtos);
      created.push(saved);
    }

    series.generatedThrough = dates[dates.length - 1];
    await this.seriesRepo.save(series);
    if (created.length) {
      this.logger.log(
        `Series "${series.name}": ${created.length} occurrence(s) created through ${series.generatedThrough}`,
      );
    }
    return created;
  }

  private async createOccurrence(
    series: EventSeries,
    date: string,
    slotDtos: ReturnType<typeof blueprintToSlotDtos>,
  ): Promise<Event> {
    const event = await this.eventService.buildOccurrence(
      {
        name: series.name,
        description: series.description ?? undefined,
        onlineAttendanceEnabled: series.onlineAttendanceEnabled,
        recurringEventId: series.id,
        seriesOccurrenceDate: date,
        audience: series.audience,
        audienceGroupId: series.audienceGroupId,
      },
      slotDtos,
    );
    const saved = await this.eventRepo.save(event);
    if (series.autoProgramme) {
      await this.eventService.prepareProgrammes(saved.serviceSlots);
    }
    return saved;
  }

  async list(): Promise<SeriesSummary[]> {
    const series = await this.seriesRepo.find({
      where: { isActive: true },
      order: { name: 'ASC' },
    });
    if (!series.length) return [];
    const rows = await this.eventRepo
      .createQueryBuilder('e')
      .select('e.recurring_event_id', 'seriesId')
      .addSelect('MIN(e.start_time)', 'next')
      .addSelect('COUNT(*)', 'count')
      .where('e.recurring_event_id IN (:...ids)', {
        ids: series.map((s) => s.id),
      })
      .andWhere('e.start_time > :now', { now: new Date() })
      .groupBy('e.recurring_event_id')
      .getRawMany<{ seriesId: string; next: Date; count: string }>();
    const byId = new Map(rows.map((r) => [r.seriesId, r]));
    return series.map((s) => this.summarise(s, byId.get(s.id)));
  }

  async get(id: string): Promise<SeriesSummary> {
    const series = await this.findOrThrow(id);
    const [next, count] = await Promise.all([
      this.eventRepo.findOne({
        where: { recurringEventId: id, startTime: MoreThan(new Date()) },
        order: { startTime: 'ASC' },
      }),
      this.eventRepo.count({
        where: { recurringEventId: id, startTime: MoreThan(new Date()) },
      }),
    ]);
    return this.summarise(series, {
      next: next?.startTime ?? null,
      count: String(count),
    });
  }

  // Upcoming services from `effectiveFrom` take the change; ones with recorded attendance or a session are left alone.
  async update(
    id: string,
    dto: UpdateEventSeriesDto,
    actorId: string,
  ): Promise<SeriesUpdateResult> {
    const series = await this.findOrThrow(id);
    const timezone = await this.churchTimezone.get();

    if (dto.name !== undefined) series.name = dto.name;
    if (dto.description !== undefined) series.description = dto.description;
    if (dto.onlineAttendanceEnabled !== undefined)
      series.onlineAttendanceEnabled = dto.onlineAttendanceEnabled;
    if (dto.autoProgramme !== undefined)
      series.autoProgramme = dto.autoProgramme;
    if (dto.audience !== undefined) {
      Object.assign(series, await this.eventService.resolveAudience(dto));
      series.audienceGroup = undefined;
    }
    const blueprint = dto.slotBlueprint as SlotBlueprint[] | undefined;
    if (blueprint) series.slotBlueprint = blueprint;

    const upcoming = await this.eventRepo.find({
      where: {
        recurringEventId: id,
        seriesOccurrenceDate: MoreThanOrEqual(dto.effectiveFrom),
        startTime: MoreThan(new Date()),
      },
      relations: [
        'serviceSlots',
        'serviceSlots.config',
        'serviceSlots.config.defaultVenue',
        'serviceSlots.venueOverride',
      ],
      order: { startTime: 'ASC' },
    });

    const history = new Map<string, boolean>();
    for (const occ of upcoming) {
      history.set(occ.id, await this.eventService.hasRecordedHistory(occ.id));
    }
    const editable = upcoming.filter((o) => !history.get(o.id));

    const needsRecreate = blueprint
      ? editable.filter(
          (o) =>
            slotNames(o.serviceSlots.map((s) => s.name)) !==
            slotNames(blueprint.map((b) => b.name)),
        )
      : [];
    if (needsRecreate.length && !dto.confirmRecreate) {
      throw new ConflictException({
        message: `${needsRecreate.length} upcoming service(s) will be recreated because services were added or removed — their draft programmes will be rebuilt from templates.`,
        code: 'SERIES_RECREATE_REQUIRED',
        affected: needsRecreate.length,
      });
    }

    const result: SeriesUpdateResult = {
      updated: 0,
      recreated: 0,
      skippedWithHistory: upcoming.length - editable.length,
    };
    const recreateIds = new Set(needsRecreate.map((o) => o.id));

    for (const occ of editable) {
      occ.name = series.name;
      occ.description = series.description ?? occ.description;
      occ.onlineAttendanceEnabled = series.onlineAttendanceEnabled;
      occ.audience = series.audience;
      occ.audienceGroupId = series.audienceGroupId;
      occ.audienceGroup = undefined;
      if (!blueprint) {
        await this.eventRepo.save(occ);
        result.updated++;
        continue;
      }
      const slotDtos = blueprintToSlotDtos(
        blueprint,
        occ.seriesOccurrenceDate!,
        timezone,
      );
      if (recreateIds.has(occ.id)) {
        await this.eventRepo.remove(occ);
        await this.createOccurrence(
          series,
          occ.seriesOccurrenceDate!,
          slotDtos,
        );
        result.recreated++;
      } else {
        await this.eventService.updateOccurrenceInPlace(occ, slotDtos);
        result.updated++;
      }
    }

    // Name changes also apply to services that already have history; their times don't.
    for (const occ of upcoming.filter((o) => history.get(o.id))) {
      if (occ.name !== series.name) {
        occ.name = series.name;
        await this.eventRepo.save(occ);
      }
    }

    await this.seriesRepo.save(series);
    this.auditLogService.log('EVENT_SERIES_UPDATED', {
      actorId,
      targetId: id,
      targetName: series.name,
      metadata: {
        effectiveFrom: dto.effectiveFrom,
        changes: Object.keys(dto).filter((k) => k !== 'effectiveFrom'),
        ...result,
      },
    });
    return result;
  }

  // Ends the series the day before `from` and removes upcoming services from then that have no history.
  async stop(
    id: string,
    from: string,
    actorId: string,
  ): Promise<{ removed: number }> {
    const series = await this.findOrThrow(id);
    series.endDate = addDays(from, -1);
    series.isActive = false;
    await this.seriesRepo.save(series);
    const removed = await this.removeUpcoming(id, from);

    this.auditLogService.log('EVENT_SERIES_STOPPED', {
      actorId,
      targetId: id,
      targetName: series.name,
      metadata: { from, removed },
    });
    return { removed };
  }

  // Legacy "delete future recurring" also retires the rule behind it, so the nightly top-up doesn't bring them back.
  async deactivate(id: string): Promise<void> {
    await this.seriesRepo.update({ id }, { isActive: false });
  }

  private async removeUpcoming(id: string, from: string): Promise<number> {
    const candidates = await this.eventRepo.find({
      where: {
        recurringEventId: id,
        seriesOccurrenceDate: MoreThanOrEqual(from),
        startTime: MoreThan(new Date()),
        attendanceMarked: false,
      },
    });
    const removable: Event[] = [];
    for (const occ of candidates) {
      if (!(await this.eventService.hasRecordedHistory(occ.id)))
        removable.push(occ);
    }
    if (removable.length) await this.eventRepo.remove(removable);
    return removable.length;
  }

  private async findOrThrow(id: string): Promise<EventSeries> {
    const series = await this.seriesRepo.findOne({ where: { id } });
    if (!series) throw new NotFoundException('Recurring service not found');
    return series;
  }

  private summarise(
    s: EventSeries,
    upcoming?: { next: Date | null; count: string },
  ): SeriesSummary {
    return {
      id: s.id,
      name: s.name,
      recurrencePattern: s.recurrencePattern,
      recurrenceInterval: s.recurrenceInterval,
      startDate: s.startDate,
      endDate: s.endDate,
      isActive: s.isActive,
      autoProgramme: s.autoProgramme,
      slotBlueprint: s.slotBlueprint,
      nextOccurrence: upcoming?.next ? new Date(upcoming.next) : null,
      upcomingCount: Number(upcoming?.count ?? 0),
    };
  }
}
