import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { EventReminder } from '../entity/event-reminder.entity';
import { PRESET_MINUTES } from '../enum/reminder-interval-preset.enum';
import { EventAudienceEnum } from '../enums/event-audience.enum';
import { Group } from '../../group/entity/group.entity';
import {
  effectiveAudience,
  eventVisibleToViewerSql,
} from '../utility/event-audience';
import { CheckinCloseModeEnum } from '../enums/checkin-close-mode.enum';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, MoreThanOrEqual, Repository } from 'typeorm';
import { Event } from '../entity/event.entity';
import { ServiceSlot } from '../entity/service-slot.entity';
import { EventConfig } from '../entity/event-config.entity';
import { Venue } from '../../venue/entity/venue.entity';
import { CreateEventDto } from '../dto/create-event.dto';
import { CreateServiceSlotDto } from '../dto/create-service-slot.dto';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { MeetingFormatEnum } from '../../utility/enum/meeting-format.enum';
import { EventConfigService } from './event-config.service';
import { VenueService } from '../../venue/service/venue.service';
import { OrderBy } from '../types/order-by.type';
import { Order } from '../types/order.type';
import { EventSeriesService } from './event-series.service';
import { ServiceProgrammeService } from '../../service-programme/service/service-programme.service';

const SLOT_RELATIONS = [
  'audienceGroup',
  'serviceSlots',
  'serviceSlots.config',
  'serviceSlots.config.defaultVenue',
  'serviceSlots.venueOverride',
];

export interface EventViewer {
  id: string;
  isWorker: boolean;
}

@Injectable()
export class EventService {
  private readonly logger = new Logger(EventService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly eventConfigService: EventConfigService,
    private readonly venueService: VenueService,
    private readonly auditLogService: AuditLogService,
    @InjectRepository(Event)
    private readonly eventRepository: Repository<Event>,
    @InjectRepository(ServiceSlot)
    private readonly slotRepository: Repository<ServiceSlot>,
    @InjectRepository(Group)
    private readonly groupRepository: Repository<Group>,
    @InjectRepository(EventReminder)
    private readonly reminderRepository: Repository<EventReminder>,
    // Tenant-scoped queries go through the request's transaction; a bare DataSource reads `public`.
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    @Inject(forwardRef(() => EventSeriesService))
    private readonly seriesService: EventSeriesService,
    private readonly programmeService: ServiceProgrammeService,
  ) {}

  async create(dto: CreateEventDto, actorId: string): Promise<Event | Event[]> {
    dto = { ...dto, ...(await this.resolveAudience(dto)) };
    if (dto.isRecurring) {
      if (!dto.recurrence)
        throw new BadRequestException(
          'Recurrence details required for recurring events',
        );
      this.validateFutureSlots(dto.serviceSlots);
      const result = await this.seriesService.createFromEvent(dto, actorId);
      this.auditLogService.log('EVENT_CREATED', {
        actorId,
        targetName: dto.name,
        metadata: {
          name: dto.name,
          isRecurring: true,
          ongoing: !!dto.recurrence.ongoing,
          count: result.length,
        },
      });
      return result;
    }

    this.validateFutureSlots(dto.serviceSlots);
    const result = await this.createSingle(dto);
    if (dto.autoProgramme !== false) {
      await this.prepareProgrammes(result.serviceSlots);
    }
    this.auditLogService.log('EVENT_CREATED', {
      actorId,
      targetId: result.id,
      targetName: result.name,
      metadata: { name: result.name, eventDate: result.eventDate },
    });
    return result;
  }

  async update(
    id: string,
    dto: Partial<CreateEventDto>,
    actorId: string,
  ): Promise<Event> {
    const event = await this.getById(id);

    if (dto.name) event.name = dto.name;
    if (dto.description !== undefined) event.description = dto.description;

    if (dto.serviceSlots?.length) {
      // Replacing the slot set deletes and recreates every ServiceSlot row,
      // and ServiceProgramme/ServiceSession/session-slots/action-log all
      // cascade off ServiceSlot (and any Attendance still pointing at the
      // deleted slot loses that reference, since the FK is ON DELETE SET
      // NULL) — so once this event has any recorded history, replacing its
      // slots would silently destroy it. Block that outright rather than
      // risk it; cosmetic fields (name/description) remain editable either way.
      if (await this.hasRecordedHistory(id)) {
        throw new BadRequestException(
          'This event has recorded session or attendance history — its schedule can no longer be edited',
        );
      }
      await this.slotRepository.delete({ event: { id } });
      const slots = await this.buildSlots(dto.serviceSlots);
      event.serviceSlots = slots;
      const { eventDate, endDate, startTime, endTime } =
        this.deriveDateRange(slots);
      event.eventDate = eventDate;
      event.endDate = endDate;
      event.startTime = startTime;
      event.endTime = endTime;
    }

    if (dto.onlineAttendanceEnabled !== undefined)
      event.onlineAttendanceEnabled = dto.onlineAttendanceEnabled;

    if (dto.audience !== undefined) {
      Object.assign(event, await this.resolveAudience(dto));
      event.audienceGroup = undefined;
    }

    const saved = await this.eventRepository.save(event);
    this.auditLogService.log('EVENT_UPDATED', {
      actorId,
      targetId: id,
      targetName: saved.name,
      metadata: { name: saved.name, changes: Object.keys(dto) },
    });
    return saved;
  }

  async getById(
    id: string,
    memberId?: string,
    viewer?: EventViewer,
  ): Promise<Event> {
    const event = await this.eventRepository.findOne({
      where: { id },
      relations: SLOT_RELATIONS,
      order: { serviceSlots: { startTime: 'ASC' } },
    });
    if (!event || (viewer && !(await this.isForViewer(event, viewer))))
      throw new NotFoundException('Event not found');
    if (memberId) await this.attachMyAttendance([event], memberId);
    return event;
  }

  async getAll(
    page = 1,
    limit = 10,
    orderBy: OrderBy = 'eventDate',
    order: Order = 'DESC',
    filter: {
      memberId?: string;
      from?: Date;
      to?: Date;
      upcoming?: boolean;
      search?: string;
      // Set for the member app: only events meant for this person.
      viewer?: EventViewer;
    } = {},
  ): Promise<PaginationResponseDto<Event>> {
    if (page < 1) throw new BadRequestException('Page must be greater than 0');

    const qb = this.eventRepository
      .createQueryBuilder('event')
      .leftJoinAndSelect('event.audienceGroup', 'audienceGroup')
      .leftJoinAndSelect('event.serviceSlots', 'serviceSlots')
      .leftJoinAndSelect('serviceSlots.config', 'config')
      .leftJoinAndSelect('config.defaultVenue', 'defaultVenue')
      .leftJoinAndSelect('serviceSlots.venueOverride', 'venueOverride')
      .orderBy(`event.${orderBy}`, order)
      .addOrderBy('serviceSlots.startTime', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    if (filter.upcoming) {
      qb.andWhere('event.endTime >= :upcomingFrom', {
        upcomingFrom: new Date(),
      });
    }
    if (filter.from)
      qb.andWhere('event.eventDate >= :from', { from: filter.from });
    if (filter.to) qb.andWhere('event.eventDate <= :to', { to: filter.to });
    if (filter.search)
      qb.andWhere('event.name ILIKE :search', { search: `%${filter.search}%` });
    if (filter.viewer)
      qb.andWhere(eventVisibleToViewerSql('event'), {
        viewerId: filter.viewer.id,
        viewerIsWorker: filter.viewer.isWorker,
      });

    const [events, total] = await qb.getManyAndCount();

    if (filter.memberId && events.length)
      await this.attachMyAttendance(events, filter.memberId);

    return UtilityService.createPaginationResponse(events, page, limit, total);
  }

  async deleteEvent(eventId: string, actorId: string): Promise<void> {
    const event = await this.eventRepository.findOne({
      where: { id: eventId },
      relations: ['serviceSlots'],
    });

    if (!event) throw new NotFoundException('Event not found');

    if (event.endTime < new Date()) {
      this.logger.warn(
        `Delete of event "${event.name}" (id: ${eventId}) blocked — event is in the past`,
      );
      throw new BadRequestException('Past events cannot be deleted');
    }
    if (event.attendanceMarked) {
      this.logger.warn(
        `Delete of event "${event.name}" (id: ${eventId}) blocked — attendance already recorded`,
      );
      throw new BadRequestException(
        'Events with recorded attendance cannot be deleted',
      );
    }

    const { name } = event;
    await this.eventRepository.remove(event);
    this.auditLogService.log('EVENT_DELETED', {
      actorId,
      targetId: eventId,
      targetName: name,
      metadata: { name },
    });
  }

  async deleteFutureRecurring(
    recurringEventId: string,
    actorId: string,
  ): Promise<void> {
    // startTime, not eventDate — a same-day occurrence that's already
    // started (or already ended) shouldn't count as "future" just because
    // its calendar date hasn't rolled over yet. attendanceMarked = false
    // matches deleteEvent's own guard against removing an occurrence that
    // already has recorded attendance, which this bulk path — unlike
    // deleteEvent — previously had no equivalent check for at all.
    const events = await this.eventRepository
      .createQueryBuilder('event')
      .where('event.recurringEventId = :recurringEventId', { recurringEventId })
      .andWhere('event.startTime >= :now', { now: new Date() })
      .andWhere('event.attendanceMarked = false')
      .getMany();

    if (!events.length)
      throw new NotFoundException('No future recurring events found');

    const name = events[0]?.name;
    await this.eventRepository.remove(events);
    await this.seriesService.deactivate(recurringEventId);
    this.auditLogService.log('EVENT_DELETED', {
      actorId,
      targetId: recurringEventId,
      targetName: name,
      metadata: {
        name,
        recurringEventId,
        count: events.length,
        isRecurring: true,
      },
    });
  }

  async findEventsReadyForAbsenceMarking(): Promise<Event[]> {
    return this.eventRepository
      .createQueryBuilder('event')
      .leftJoinAndSelect('event.serviceSlots', 'slot')
      .where('event.attendanceMarked = false')
      .andWhere('event.endTime < :now', { now: new Date() })
      .andWhere(
        'EXISTS (SELECT 1 FROM service_slots s WHERE s.event_id = event.id)',
      )
      .getMany();
  }

  // When the next event with service slots ends and will need absence marking (null if none).
  async nextAbsenceMarkingDue(): Promise<Date | null> {
    const row = await this.eventRepository
      .createQueryBuilder('event')
      .select('MIN(event.end_time)', 'next')
      .where('event.attendance_marked = false')
      .andWhere('event.end_time >= :now', { now: new Date() })
      .andWhere(
        'EXISTS (SELECT 1 FROM service_slots s WHERE s.event_id = event.id)',
      )
      .getRawOne<{ next: Date | string | null }>();
    return row?.next ? new Date(row.next) : null;
  }

  async getUpcomingEvents(limit = 5): Promise<Event[]> {
    return this.eventRepository.find({
      where: { endTime: MoreThanOrEqual(new Date()) },
      order: { startTime: 'ASC', serviceSlots: { startTime: 'ASC' } },
      relations: [
        'serviceSlots',
        'serviceSlots.config',
        'serviceSlots.config.defaultVenue',
        'serviceSlots.venueOverride',
      ],
      take: limit,
    });
  }

  resolveSlotConfig(slot: ServiceSlot): {
    workerCheckinStartOffsetSeconds: number;
    workerLateOffsetSeconds: number;
    memberCheckinStartOffsetSeconds: number;
    checkinStopOffsetSeconds: number;
    checkinCloseMode: CheckinCloseModeEnum;
    venue: Venue | null;
    allowedDistanceInMeters: number;
    format: MeetingFormatEnum;
    onlineMeetingUrl: string | null;
    enforceMemberLocation: boolean;
  } {
    const c = slot.config;
    if (!c)
      throw new BadRequestException(
        `Service slot "${slot.name}" has no config`,
      );

    const format = slot.formatOverride ?? c.defaultFormat;
    const venue = slot.venueOverride ?? c.defaultVenue;
    if (format === MeetingFormatEnum.IN_PERSON && !venue)
      throw new BadRequestException(
        `Service slot "${slot.name}" has no venue configured`,
      );

    return {
      workerCheckinStartOffsetSeconds:
        slot.workerCheckinStartOverride ?? c.workerCheckinStartOffsetSeconds,
      workerLateOffsetSeconds:
        slot.workerLateOverride ?? c.workerLateOffsetSeconds,
      memberCheckinStartOffsetSeconds:
        slot.memberCheckinStartOverride ?? c.memberCheckinStartOffsetSeconds,
      checkinStopOffsetSeconds:
        slot.checkinStopOverride ?? c.checkinStopOffsetSeconds,
      checkinCloseMode:
        slot.checkinCloseModeOverride ??
        c.checkinCloseMode ??
        CheckinCloseModeEnum.AFTER_START,
      venue,
      allowedDistanceInMeters:
        slot.allowedDistanceOverride ?? c.allowedDistanceInMeters,
      format,
      onlineMeetingUrl: c.onlineMeetingUrl,
      enforceMemberLocation:
        slot.enforceMemberLocationOverride ?? c.enforceMemberLocation,
    };
  }

  private validateFutureSlots(slots: CreateServiceSlotDto[]): void {
    const now = Date.now();
    if (slots.some((slot) => new Date(slot.startTime).getTime() < now)) {
      throw new BadRequestException('Service slots cannot start in the past');
    }
  }

  private async createSingle(dto: CreateEventDto): Promise<Event> {
    const slots = await this.buildSlots(dto.serviceSlots);
    const { eventDate, endDate, startTime, endTime } =
      this.deriveDateRange(slots);
    const event = this.eventRepository.create({
      name: dto.name,
      description: dto.description,
      eventDate,
      endDate,
      startTime,
      endTime,
      onlineAttendanceEnabled: dto.onlineAttendanceEnabled ?? false,
      audience: dto.audience ?? EventAudienceEnum.EVERYONE,
      audienceGroupId: dto.audienceGroupId ?? null,
    });
    event.serviceSlots = slots;
    return this.eventRepository.save(event);
  }

  // Groups an event can be for — reference data, so the full list.
  listAudienceGroups(): Promise<Pick<Group, 'id' | 'name'>[]> {
    return this.groupRepository.find({
      select: ['id', 'name'],
      order: { name: 'ASC' },
    });
  }

  // Validates the group for a GROUP audience; any other audience carries no group.
  async resolveAudience(dto: {
    audience?: EventAudienceEnum;
    audienceGroupId?: string | null;
  }): Promise<{ audience: EventAudienceEnum; audienceGroupId: string | null }> {
    const audience = dto.audience ?? EventAudienceEnum.EVERYONE;
    if (audience !== EventAudienceEnum.GROUP) {
      return { audience, audienceGroupId: null };
    }
    if (
      !dto.audienceGroupId ||
      !(await this.groupRepository.existsBy({ id: dto.audienceGroupId }))
    ) {
      throw new BadRequestException('Choose an existing group for this event');
    }
    return { audience, audienceGroupId: dto.audienceGroupId };
  }

  private async isForViewer(
    event: Event,
    viewer: EventViewer,
  ): Promise<boolean> {
    const audience = effectiveAudience(event);
    if (audience === EventAudienceEnum.WORKERS) return viewer.isWorker;
    if (audience !== EventAudienceEnum.GROUP) return true;
    const rows: unknown[] = await this.txHost.tx.query(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND member_id = $2 LIMIT 1',
      [event.audienceGroupId, viewer.id],
    );
    return rows.length > 0;
  }

  // An unsaved event built from absolute slots — used by the series service for each occurrence.
  async buildOccurrence(
    fields: Pick<Event, 'name' | 'onlineAttendanceEnabled'> &
      Partial<
        Pick<
          Event,
          | 'description'
          | 'recurringEventId'
          | 'seriesOccurrenceDate'
          | 'audience'
          | 'audienceGroupId'
        >
      >,
    slotDtos: CreateServiceSlotDto[],
  ): Promise<Event> {
    const slots = await this.buildSlots(slotDtos);
    const event = this.eventRepository.create({
      ...fields,
      ...this.deriveDateRange(slots),
    });
    event.serviceSlots = slots;
    return event;
  }

  // Moves an upcoming occurrence's services to new times/settings without recreating them, so programmes stay attached.
  async updateOccurrenceInPlace(
    event: Event,
    slotDtos: CreateServiceSlotDto[],
  ): Promise<Event> {
    const rebuilt = await this.buildSlots(slotDtos);
    const byName = new Map(event.serviceSlots.map((s) => [s.name, s]));
    const previousStart = new Map(
      event.serviceSlots.map((s) => [s.id, s.startTime.getTime()]),
    );
    const updated = rebuilt.map((next) => {
      const slot = byName.get(next.name);
      if (!slot) {
        throw new BadRequestException(
          `Service "${next.name}" doesn't exist on ${event.name}`,
        );
      }
      return Object.assign(slot, {
        startTime: next.startTime,
        endTime: next.endTime,
        config: next.config,
        workerCheckinStartOverride: next.workerCheckinStartOverride,
        workerLateOverride: next.workerLateOverride,
        memberCheckinStartOverride: next.memberCheckinStartOverride,
        checkinStopOverride: next.checkinStopOverride,
        checkinCloseModeOverride: next.checkinCloseModeOverride,
        allowedDistanceOverride: next.allowedDistanceOverride,
        enforceMemberLocationOverride: next.enforceMemberLocationOverride,
        venueOverride: next.venueOverride,
        formatOverride: next.formatOverride,
      });
    });
    await this.slotRepository.save(updated);
    await this.retimeReminders(
      updated.filter((s) => previousStart.get(s.id) !== s.startTime.getTime()),
    );
    Object.assign(event, this.deriveDateRange(updated));
    event.serviceSlots = updated;
    return this.eventRepository.save(event);
  }

  // Reminders fire at a precomputed time, so a service moved in place needs its unsent reminders moved with it.
  private async retimeReminders(moved: ServiceSlot[]): Promise<void> {
    if (!moved.length) return;
    const startById = new Map(moved.map((s) => [s.id, s.startTime]));
    const reminders = await this.reminderRepository.find({
      where: {
        serviceSlot: { id: In([...startById.keys()]) },
        lastSentAt: IsNull(),
      },
      relations: ['serviceSlot'],
    });
    for (const r of reminders) {
      const start = startById.get(r.serviceSlot.id)!;
      r.fireAt = new Date(
        start.getTime() - PRESET_MINUTES[r.intervalPreset] * 60_000,
      );
    }
    // Saved through the repository so the scheduler gate wakes the reminder job.
    if (reminders.length) await this.reminderRepository.save(reminders);
  }

  // Non-fatal: a template problem must never stop the event itself being created.
  async prepareProgrammes(slots: ServiceSlot[]): Promise<void> {
    try {
      await this.programmeService.createDraftsFromTemplates(slots ?? []);
    } catch (err) {
      this.logger.warn(
        `Could not prepare programmes from templates: ${(err as Error).message}`,
      );
    }
  }

  /** Event.eventDate/endDate/startTime/endTime are all derived from the slots, not entered independently. */
  private deriveDateRange(slots: ServiceSlot[]): {
    eventDate: Date;
    endDate: Date;
    startTime: Date;
    endTime: Date;
  } {
    const startTime = new Date(
      Math.min(...slots.map((s) => s.startTime.getTime())),
    );
    const endTime = new Date(
      Math.max(...slots.map((s) => s.endTime.getTime())),
    );
    return {
      eventDate: this.truncateToUtcDate(startTime),
      endDate: this.truncateToUtcDate(endTime),
      startTime,
      endTime,
    };
  }

  // Event.eventDate/endDate are plain `date` columns and must be UTC-midnight
  // truncated regardless of server timezone — date-fns' startOfDay truncates
  // in local time, which would silently shift the date on non-UTC servers.
  private truncateToUtcDate(date: Date): Date {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }

  private async buildSlots(
    slotDtos: CreateServiceSlotDto[],
  ): Promise<ServiceSlot[]> {
    const slots = await Promise.all(
      slotDtos.map((dto) => this.buildSlotFromDto(dto)),
    );
    this.validateSlotSequence(slots);
    return slots;
  }

  private validateSlotSequence(slots: ServiceSlot[]): void {
    // Sort by startTime ascending so validation is order-independent in the DTO
    slots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    for (let i = 1; i < slots.length; i++) {
      const slot = slots[i];
      if (slot.startTime < slots[i - 1].endTime) {
        throw new BadRequestException(
          `Slot "${slot.name}" overlaps with "${slots[i - 1].name}". Each slot must start after the previous one ends.`,
        );
      }
    }
  }

  private async buildSlotFromDto(
    dto: CreateServiceSlotDto,
  ): Promise<ServiceSlot> {
    const start = new Date(dto.startTime);
    const end = new Date(dto.endTime);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid slot startTime or endTime');
    }
    if (start >= end) {
      throw new BadRequestException(
        `Slot "${dto.name ?? 'Service'}" startTime must be before endTime`,
      );
    }

    let config: EventConfig | undefined;
    if (dto.configId) {
      config = await this.eventConfigService.get(dto.configId);
    }

    let venueOverride: Venue | null = null;
    if (dto.venueOverrideId) {
      venueOverride = await this.venueService.getById(dto.venueOverrideId);
    }
    const formatOverride = dto.formatOverride ?? null;

    // A slot resolving to IN_PERSON (whether via its own override or the
    // config's default) must resolve to a real venue too — checked here,
    // at save time, rather than leaving it to surface only when the first
    // person tries to check in (EventService.resolveSlotConfig throws the
    // same way, but that's too late for the admin who saved a broken slot).
    const resolvedFormat = formatOverride ?? config?.defaultFormat;
    const resolvedVenue = venueOverride ?? config?.defaultVenue;
    if (resolvedFormat === MeetingFormatEnum.IN_PERSON && !resolvedVenue) {
      throw new BadRequestException(
        `Slot "${dto.name ?? 'Service'}" is in-person but has no venue configured — set a venue override or use a config with a default venue`,
      );
    }

    // A config's stop offset is a ceiling — check-in also closes when the service ends
    // (AttendanceService.validateCheckinWindow), so one config fits services of any length.
    // An override is set for this one service, so one longer than it is a mistake.
    if (
      dto.checkinStopOverride !== undefined &&
      dto.checkinCloseModeOverride !== CheckinCloseModeEnum.SERVICE_END
    ) {
      const durationSeconds = (end.getTime() - start.getTime()) / 1000;
      if (dto.checkinStopOverride > durationSeconds) {
        throw new BadRequestException(
          `Slot "${dto.name ?? 'Service'}" closes check-in ${Math.round(dto.checkinStopOverride / 60)} min after it starts, but it only runs ${Math.round(durationSeconds / 60)} min — shorten its check-in override`,
        );
      }
    }

    return this.slotRepository.create({
      name: dto.name ?? 'Service',
      startTime: start,
      endTime: end,
      config,
      workerCheckinStartOverride: dto.workerCheckinStartOverride ?? null,
      workerLateOverride: dto.workerLateOverride ?? null,
      memberCheckinStartOverride: dto.memberCheckinStartOverride ?? null,
      checkinStopOverride: dto.checkinStopOverride ?? null,
      checkinCloseModeOverride: dto.checkinCloseModeOverride ?? null,
      allowedDistanceOverride: dto.allowedDistanceOverride ?? null,
      enforceMemberLocationOverride: dto.enforceMemberLocationOverride ?? null,
      venueOverride,
      formatOverride,
    });
  }

  /** True if this event has any recorded attendance or any service session (LIVE or COMPLETED) ever started for one of its slots. */
  async hasRecordedHistory(eventId: string): Promise<boolean> {
    const [attendance, session] = await Promise.all([
      this.txHost.tx
        .createQueryBuilder()
        .select('1')
        .from('attendances', 'a')
        .where('a.event_id = :eventId', { eventId })
        .limit(1)
        .getRawOne(),
      this.txHost.tx
        .createQueryBuilder()
        .select('1')
        .from('service_sessions', 'ss')
        .innerJoin('service_programmes', 'sp', 'sp.id = ss.programme_id')
        .innerJoin('service_slots', 'slot', 'slot.id = sp.service_slot_id')
        .where('slot.event_id = :eventId', { eventId })
        .limit(1)
        .getRawOne(),
    ]);
    return !!attendance || !!session;
  }

  private async attachMyAttendance(
    events: Event[],
    memberId: string,
  ): Promise<void> {
    const eventIds = events.map((e) => e.id);
    if (!eventIds.length) return;

    const rows = await this.txHost.tx
      .createQueryBuilder()
      .select('a.event_id', 'eventId')
      .addSelect('a.service_slot_id', 'slotId')
      .addSelect('a.status', 'status')
      .addSelect('a.checkin_time', 'checkinTime')
      .from('attendances', 'a')
      .where('a.member_id = :memberId', { memberId })
      .andWhere('a.event_id IN (:...eventIds)', { eventIds })
      // Matches AttendanceService's own GENUINELY_ATTENDED_STATUSES
      // (PRESENT/LATE/ATTENDED_ONLINE, the same set getAttendanceStreak
      // already uses) — must stay in sync with what AttendanceService.
      // checkin() treats as "already checked in", or this flag (which
      // drives the member app's check-in button/icon) can disagree with
      // the backend that actually enforces it.
      .andWhere(`a.status IN ('PRESENT', 'LATE', 'ATTENDED_ONLINE')`)
      .getRawMany<{
        eventId: string;
        slotId: string | null;
        status: string;
        checkinTime: Date | null;
      }>();

    const byEventId = new Map(rows.map((r) => [r.eventId, r]));

    for (const event of events) {
      const rec = byEventId.get(event.id);
      event.checkedIn = !!rec;
      event.myCheckin = rec
        ? {
            slotId: rec.slotId ?? '',
            slotName:
              event.serviceSlots?.find((s) => s.id === rec.slotId)?.name ??
              null,
            status: rec.status,
            checkinTime: rec.checkinTime,
          }
        : null;
    }
  }
}
