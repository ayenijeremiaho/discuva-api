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
import { ChurchTimezoneService } from '../../utility/service/church-timezone.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import {
  EventOverlapService,
  OverlapCandidate,
  clashText,
  overlapKey,
  servicesClash,
} from './event-overlap.service';
import { EventOverlapRule } from '../enums/event-overlap-rule.enum';
import {
  EventPreview,
  GivingWay,
  OverlapDetail,
  PreviewDate,
} from '../types/event-preview';
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

// A series date left off the schedule because something was already booked then.
export interface SkippedDate {
  date: string;
  clashesWith: string;
  // Why, on its own: its First Service (9:00 AM–11:00 AM) overlaps "Easter Conference" (…).
  reason: string;
  clash: OverlapDetail;
  // Ready to show: Skipped Sun 5 Apr — its First Service (9:00 AM–11:00 AM) overlaps "Easter Conference" (…).
  note: string;
}

export interface GenerateResult {
  created: Event[];
  skipped: SkippedDate[];
}

export interface SeriesUpdateResult {
  updated: number;
  recreated: number;
  skippedWithHistory: number;
  // Dates left as they were, or not created, because the new times clash with something booked.
  skipped: SkippedDate[];
  // Set when the series moved to a new date: where it now repeats from.
  movedTo?: string;
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
    private readonly overlapService: EventOverlapService,
  ) {}

  async createFromEvent(
    dto: CreateEventDto,
    actorId: string,
  ): Promise<GenerateResult> {
    const timezone = await this.churchTimezone.get();
    const series = await this.seriesRepo.save(
      this.buildSeries(dto, timezone, actorId),
    );
    // A fixed end date is created in full, as before; an ongoing series is topped up nightly.
    const until = series.endDate ?? undefined;
    const { created, skipped } = await this.generate(
      series,
      timezone,
      new Date(),
      until,
    );
    // A series that can't land on any date is a mistake, not a schedule; the request rolls back.
    if (!created.length && skipped.length) {
      throw new BadRequestException({
        message: `Every date clashes with "${skipped[0].clashesWith}". Pick another time.`,
        code: 'EVENT_OVERLAP',
      });
    }
    return { created, skipped };
  }

  // An unsaved series from the create form, checked as create checks it.
  private buildSeries(
    dto: CreateEventDto,
    timezone: string,
    actorId?: string,
  ): EventSeries {
    const recurrence = dto.recurrence!;
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
    return this.seriesRepo.create({
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
      ...(actorId && { createdBy: { id: actorId } as Member }),
    });
  }

  // What creating this series would do, date by date, without saving anything.
  async preview(dto: CreateEventDto): Promise<EventPreview> {
    const timezone = await this.churchTimezone.get();
    const series = this.buildSeries(dto, timezone);
    const pending = await this.planDates(
      series,
      timezone,
      new Date(),
      series.endDate ?? undefined,
    );
    const clashing = await this.clashingDates(series, pending);
    const dates: PreviewDate[] = pending.map(({ date, slotDtos }) => {
      const clash = clashing.get(date);
      return {
        date,
        startTime: slotDtos[0].startTime,
        endTime: slotDtos[slotDtos.length - 1].endTime,
        status: clash ? 'SKIPPED' : 'READY',
        clashes: clash ? [clash.clash] : [],
      };
    });
    return {
      dates,
      givingWay: [],
      canSave: dates.some((d) => d.status === 'READY'),
    };
  }

  // What an edit would do to the upcoming dates it can change: not started, no check-ins or session. Saves nothing.
  async previewUpdate(
    id: string,
    dto: UpdateEventSeriesDto,
  ): Promise<EventPreview> {
    const series = this.seriesRepo.create({ ...(await this.findOrThrow(id)) });
    const timezone = await this.churchTimezone.get();
    if (dto.name !== undefined) series.name = dto.name;
    if (dto.audience !== undefined)
      Object.assign(series, await this.eventService.resolveAudience(dto));
    const blueprint = dto.slotBlueprint as SlotBlueprint[] | undefined;
    if (blueprint) series.slotBlueprint = blueprint;

    if (dto.moveTo && dto.moveTo !== series.startDate)
      return this.previewMove(series, dto, dto.moveTo, timezone);

    const upcoming = await this.upcomingOccurrences(id, dto.effectiveFrom);
    const editable: Event[] = [];
    for (const occ of upcoming)
      if (!(await this.eventService.hasRecordedHistory(occ.id)))
        editable.push(occ);
    const changing = this.planEdit(series, editable, blueprint, timezone);
    const clashing = await this.clashingDates(
      series,
      changing.filter((p) => p.changes),
      true,
    );
    const dates: PreviewDate[] = changing.map(
      ({ occ, date, slotDtos, current }) => {
        const clash = clashing.get(date);
        // A date left as it is keeps its current times, so show those.
        const shown = clash ? current : slotDtos;
        return {
          date,
          startTime: shown[0].startTime,
          endTime: shown[shown.length - 1].endTime,
          status: clash ? 'SKIPPED' : 'READY',
          clashes: clash ? [clash.clash] : [],
          recreated:
            !clash &&
            !!blueprint &&
            slotNames(occ.serviceSlots.map((s) => s.name)) !==
              slotNames(blueprint.map((b) => b.name)),
        };
      },
    );
    return {
      dates,
      givingWay: [],
      canSave: true,
      keptWithHistory: upcoming.length - editable.length,
    };
  }

  private async previewMove(
    series: EventSeries,
    dto: UpdateEventSeriesDto,
    moveTo: string,
    timezone: string,
  ): Promise<EventPreview> {
    this.assertMoveDate(series, moveTo, timezone);
    const from = moveTo < dto.effectiveFrom ? moveTo : dto.effectiveFrom;
    const upcoming = await this.upcomingOccurrences(series.id, from);
    const kept = new Set<string>();
    for (const occ of upcoming)
      if (await this.eventService.hasRecordedHistory(occ.id))
        kept.add(occ.seriesOccurrenceDate!);
    series.startDate = moveTo;
    series.generatedThrough = null;
    const pending = await this.planDates(
      series,
      timezone,
      new Date(),
      series.endDate ?? undefined,
      kept,
    );
    const clashing = await this.clashingDates(series, pending);
    const dates: PreviewDate[] = pending.map(({ date, slotDtos }) => {
      const clash = clashing.get(date);
      return {
        date,
        startTime: slotDtos[0].startTime,
        endTime: slotDtos[slotDtos.length - 1].endTime,
        status: clash ? 'SKIPPED' : 'READY',
        clashes: clash ? [clash.clash] : [],
      };
    });
    return {
      dates,
      givingWay: [],
      canSave: dates.some((d) => d.status === 'READY'),
      keptWithHistory: kept.size,
      movedTo: moveTo,
    };
  }

  // Each editable date with its new services, and whether its time, venue, format or audience changes:
  // only those can create a clash, so only those are checked. Renames and check-in windows never are.
  private planEdit(
    series: EventSeries,
    editable: Event[],
    blueprint: SlotBlueprint[] | undefined,
    timezone: string,
  ) {
    return editable.map((occ) => {
      const current = occ.serviceSlots.map((s) =>
        this.eventService.toSlotDto(s),
      );
      const slotDtos = blueprint
        ? blueprintToSlotDtos(blueprint, occ.seriesOccurrenceDate!, timezone)
        : current;
      return {
        occ,
        date: occ.seriesOccurrenceDate!,
        slotDtos,
        current,
        changes:
          overlapKey(slotDtos, series.audience) !==
          overlapKey(current, occ.audience),
      };
    });
  }

  // Upcoming = from this date and not started yet, so a service under way is never touched.
  private upcomingOccurrences(seriesId: string, from: string) {
    return this.eventRepo.find({
      where: {
        recurringEventId: seriesId,
        seriesOccurrenceDate: MoreThanOrEqual(from),
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
  }

  private assertMoveDate(
    series: EventSeries,
    moveTo: string,
    timezone: string,
  ): void {
    const today = localDate(new Date(), timezone);
    if (moveTo < today)
      throw new BadRequestException('Pick a date from today onwards');
    if (series.endDate && moveTo > series.endDate)
      throw new BadRequestException('The new date is after this series ends');
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
  // Creates any occurrences missing up to the horizon (or `until`); dates at or before generatedThrough are never
  // revisited. A date that clashes with something already booked is skipped: the series fills in around it.
  async generate(
    series: EventSeries,
    timezone: string,
    now = new Date(),
    until?: string,
  ): Promise<GenerateResult> {
    const dates = this.datesToCreate(series, timezone, now, until);
    if (!dates.length) return { created: [], skipped: [] };
    await this.overlapService.lockSchedule();
    const pending = await this.planDates(series, timezone, now, until);

    const clashing = await this.clashingDates(
      series,
      pending.map((p) => ({ date: p.date, slotDtos: p.slotDtos })),
    );
    const created: Event[] = [];
    for (const { date, slotDtos } of pending) {
      if (clashing.has(date)) continue;
      created.push(await this.createOccurrence(series, date, slotDtos));
    }

    series.generatedThrough = dates[dates.length - 1];
    await this.seriesRepo.save(series);
    const skipped = [...clashing.values()];
    if (created.length || skipped.length) {
      this.logger.log(
        `Series "${series.name}": ${created.length} occurrence(s) created through ${series.generatedThrough}` +
          (skipped.length
            ? `; skipped ${skipped.map((s) => s.date).join(', ')}`
            : ''),
      );
    }
    return { created, skipped };
  }

  private datesToCreate(
    series: EventSeries,
    timezone: string,
    now: Date,
    until?: string,
  ): string[] {
    const horizon =
      until ?? addDays(localDate(now, timezone), SERIES_HORIZON_DAYS);
    return this.occurrenceDates(series, horizon).filter(
      (d) => !series.generatedThrough || d > series.generatedThrough,
    );
  }

  // The dates generate would create, with their services: not started yet and not already there.
  private async planDates(
    series: EventSeries,
    timezone: string,
    now: Date,
    until?: string,
    // A preview of a move says which dates will still be there, since the rest are about to be replaced.
    existing?: Set<string>,
  ): Promise<
    { date: string; slotDtos: ReturnType<typeof blueprintToSlotDtos> }[]
  > {
    const pending: {
      date: string;
      slotDtos: ReturnType<typeof blueprintToSlotDtos>;
    }[] = [];
    for (const date of this.datesToCreate(series, timezone, now, until)) {
      const slotDtos = blueprintToSlotDtos(
        series.slotBlueprint,
        date,
        timezone,
      );
      if (slotDtos.some((s) => Date.parse(s.startTime) <= now.getTime()))
        continue;
      // An unsaved series (a preview) has no dates yet; without an id this lookup would match any series.
      const exists = existing
        ? existing.has(date)
        : !!series.id &&
          (await this.eventRepo.existsBy({
            recurringEventId: series.id,
            seriesOccurrenceDate: date,
          }));
      if (!exists) pending.push({ date, slotDtos });
    }
    return pending;
  }

  // Which of these dates clash with something already booked, other than this series itself. One query.
  private async clashingDates(
    series: EventSeries,
    occurrences: {
      date: string;
      slotDtos: ReturnType<typeof blueprintToSlotDtos>;
    }[],
    // A series edit leaves a clashing date as it was rather than skipping it.
    leaving = false,
  ): Promise<Map<string, SkippedDate>> {
    const result = new Map<string, SkippedDate>();
    if (!occurrences.length) return result;
    const rule = await this.overlapService.getRule();
    if (rule === EventOverlapRule.ALLOW) return result;
    const venues = new Map<string, Promise<string | null>>();
    const candidates: OverlapCandidate[] = [];
    const dateOf = new Map<OverlapCandidate, string>();
    for (const occ of occurrences) {
      const mine = await this.eventService.toCandidates(
        occ.slotDtos,
        series.audience,
        venues,
      );
      mine.forEach((c) => dateOf.set(c, occ.date));
      candidates.push(...mine);
    }
    const clashes = await this.overlapService.findClashes(candidates, rule, {
      seriesId: series.id,
    });
    for (const clash of clashes) {
      const date = dateOf.get(clash.slot)!;
      if (result.has(date)) continue;
      const detail = await this.overlapService.overlapDetail(
        rule,
        clash.slot,
        clash,
      );
      const reason = clashText(
        `${leaving ? 'the new' : 'its'} ${clash.slot.name}`,
        detail,
      );
      const day = await this.overlapService.day(clash.slot.startTime);
      result.set(date, {
        date,
        clashesWith: clash.eventName,
        reason,
        clash: detail,
        note: leaving
          ? `Left ${day} as it was — ${reason}.`
          : `Skipped ${day} — ${reason}.`,
      });
    }
    return result;
  }

  // Ongoing series dates not created yet that clash with these services. The top-up will skip them, so say so now.
  // Notes for the notice after saving; the preview uses givingWay's parts.
  async datesGivingWay(
    candidates: OverlapCandidate[],
    rule: EventOverlapRule,
    bookedName: string,
    excludeSeriesId?: string,
  ): Promise<string[]> {
    const dates = await this.givingWay(
      candidates,
      rule,
      bookedName,
      excludeSeriesId,
    );
    return dates.map(
      (g) =>
        `${g.seriesName} won't be added on ${g.day} — ${clashText(`its ${g.clash.service.name}`, g.clash)}.`,
    );
  }

  // Ongoing series dates not created yet that clash with these services. The top-up will skip them, so say so now.
  async givingWay(
    candidates: OverlapCandidate[],
    rule: EventOverlapRule,
    bookedName: string,
    excludeSeriesId?: string,
  ): Promise<GivingWay[]> {
    if (!candidates.length || rule === EventOverlapRule.ALLOW) return [];
    const timezone = await this.churchTimezone.get();
    const from = addDays(
      localDate(
        new Date(Math.min(...candidates.map((c) => c.startTime.getTime()))),
        timezone,
      ),
      -7,
    );
    const to = localDate(
      new Date(Math.max(...candidates.map((c) => c.endTime.getTime()))),
      timezone,
    );
    const ongoing = await this.seriesRepo.find({ where: { isActive: true } });
    const venues = new Map<string, Promise<string | null>>();
    const result: GivingWay[] = [];
    for (const series of ongoing) {
      if (series.id === excludeSeriesId) continue;
      if (series.endDate && series.endDate < from) continue;
      const dates = this.occurrenceDates(series, to).filter(
        (d) =>
          d >= from &&
          (!series.generatedThrough || d > series.generatedThrough),
      );
      for (const date of dates) {
        const theirs = await this.eventService.toCandidates(
          blueprintToSlotDtos(series.slotBlueprint, date, timezone),
          series.audience,
          venues,
        );
        let pair: [OverlapCandidate, OverlapCandidate] | undefined;
        for (const t of theirs) {
          const c = candidates.find((c) => servicesClash(t, c, rule));
          if (c) {
            pair = [t, c];
            break;
          }
        }
        if (!pair) continue;
        const [hit, booked] = pair;
        result.push({
          seriesName: series.name,
          date,
          day: await this.overlapService.day(hit.startTime),
          clash: await this.overlapService.overlapDetail(rule, hit, {
            eventName: bookedName,
            slotName: booked.name,
            startTime: booked.startTime,
            endTime: booked.endTime,
            theirsForEveryone: booked.forEveryone,
            venueName:
              booked.venueId && booked.venueId === hit.venueId
                ? await this.overlapService.venueName(booked.venueId)
                : null,
          }),
        });
      }
    }
    return result;
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

    if (dto.moveTo && dto.moveTo !== series.startDate) {
      return this.move(series, dto, dto.moveTo, timezone, actorId);
    }

    const upcoming = await this.upcomingOccurrences(id, dto.effectiveFrom);

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
      skipped: [],
    };
    const recreateIds = new Set(needsRecreate.map((o) => o.id));
    // A date whose new time, venue or audience would clash keeps those; its name and description still change.
    await this.overlapService.lockSchedule();
    const clashing = await this.clashingDates(
      series,
      this.planEdit(series, editable, blueprint, timezone).filter(
        (p) => p.changes,
      ),
      true,
    );

    for (const occ of editable) {
      occ.name = series.name;
      occ.description = series.description ?? occ.description;
      occ.onlineAttendanceEnabled = series.onlineAttendanceEnabled;
      const clash = clashing.get(occ.seriesOccurrenceDate!);
      if (clash) {
        await this.eventRepo.save(occ);
        result.skipped.push(clash);
        continue;
      }
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

  // Re-anchors the series on `moveTo`: upcoming services from the earlier of moveTo and effectiveFrom are
  // replaced by ones on the new schedule; services with recorded attendance or a session stay where they are.
  private async move(
    series: EventSeries,
    dto: UpdateEventSeriesDto,
    moveTo: string,
    timezone: string,
    actorId: string,
  ): Promise<SeriesUpdateResult> {
    this.assertMoveDate(series, moveTo, timezone);
    const from = moveTo < dto.effectiveFrom ? moveTo : dto.effectiveFrom;
    const upcoming = await this.eventRepo.find({
      where: {
        recurringEventId: series.id,
        seriesOccurrenceDate: MoreThanOrEqual(from),
        startTime: MoreThan(new Date()),
      },
      order: { startTime: 'ASC' },
    });
    const replace: Event[] = [];
    for (const occ of upcoming) {
      if (!(await this.eventService.hasRecordedHistory(occ.id)))
        replace.push(occ);
    }
    if (replace.length && !dto.confirmRecreate) {
      throw new ConflictException({
        message: `${replace.length} upcoming date(s) will move to the new schedule — their draft programmes will be rebuilt from templates.`,
        code: 'SERIES_RECREATE_REQUIRED',
        affected: replace.length,
      });
    }

    if (replace.length) await this.eventRepo.remove(replace);
    series.startDate = moveTo;
    series.generatedThrough = null;
    const { created, skipped } = await this.generate(
      series,
      timezone,
      new Date(),
      series.endDate ?? undefined,
    );
    const result: SeriesUpdateResult = {
      updated: 0,
      recreated: created.length,
      skippedWithHistory: upcoming.length - replace.length,
      skipped,
      movedTo: moveTo,
    };
    this.auditLogService.log('EVENT_SERIES_UPDATED', {
      actorId,
      targetId: series.id,
      targetName: series.name,
      metadata: {
        effectiveFrom: dto.effectiveFrom,
        changes: Object.keys(dto).filter((k) => k !== 'effectiveFrom'),
        removed: replace.length,
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
