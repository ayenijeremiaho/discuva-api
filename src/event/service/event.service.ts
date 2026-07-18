import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThanOrEqual, Repository } from 'typeorm';
import { Event } from '../entity/event.entity';
import { ServiceSlot } from '../entity/service-slot.entity';
import { EventConfig } from '../entity/event-config.entity';
import { Venue } from '../../venue/entity/venue.entity';
import { addDays, addMonths, addWeeks } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import { CreateEventDto } from '../dto/create-event.dto';
import { CreateServiceSlotDto } from '../dto/create-service-slot.dto';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { EventConfigService } from './event-config.service';
import { VenueService } from '../../venue/service/venue.service';
import { OrderBy } from '../types/order-by.type';
import { Order } from '../types/order.type';

const SLOT_RELATIONS = [
  'serviceSlots',
  'serviceSlots.config',
  'serviceSlots.config.defaultVenue',
  'serviceSlots.venueOverride',
];

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
  ) {}

  async create(dto: CreateEventDto, actorId: string): Promise<Event | Event[]> {
    if (dto.isRecurring) {
      if (!dto.recurrence)
        throw new BadRequestException(
          'Recurrence details required for recurring events',
        );
      const result = await this.createRecurring(dto);
      this.auditLogService.log('EVENT_CREATED', {
        actorId,
        metadata: { name: dto.name, isRecurring: true, count: result.length },
      });
      return result;
    }

    const result = await this.createSingle(dto);
    this.auditLogService.log('EVENT_CREATED', {
      actorId,
      targetId: result.id,
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
      await this.slotRepository.delete({ event: { id } });
      const slots = await this.buildSlots(dto.serviceSlots);
      event.serviceSlots = slots;
      const { eventDate, endDate } = this.deriveDateRange(slots);
      event.eventDate = eventDate;
      event.endDate = endDate;
    }

    if (dto.onlineAttendanceEnabled !== undefined)
      event.onlineAttendanceEnabled = dto.onlineAttendanceEnabled;

    const saved = await this.eventRepository.save(event);
    this.auditLogService.log('EVENT_UPDATED', {
      actorId,
      targetId: id,
      metadata: { name: saved.name, changes: Object.keys(dto) },
    });
    return saved;
  }

  async getById(id: string, memberId?: string): Promise<Event> {
    const event = await this.eventRepository.findOne({
      where: { id },
      relations: SLOT_RELATIONS,
    });
    if (!event) throw new NotFoundException('Event not found');
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
    } = {},
  ): Promise<PaginationResponseDto<Event>> {
    if (page < 1) throw new BadRequestException('Page must be greater than 0');

    const qb = this.eventRepository
      .createQueryBuilder('event')
      .leftJoinAndSelect('event.serviceSlots', 'serviceSlots')
      .leftJoinAndSelect('serviceSlots.config', 'config')
      .leftJoinAndSelect('config.defaultVenue', 'defaultVenue')
      .leftJoinAndSelect('serviceSlots.venueOverride', 'venueOverride')
      .orderBy(`event.${orderBy}`, order)
      .skip((page - 1) * limit)
      .take(limit);

    if (filter.upcoming) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      qb.andWhere('event.eventDate >= :upcomingFrom', { upcomingFrom: today });
    }
    if (filter.from)
      qb.andWhere('event.eventDate >= :from', { from: filter.from });
    if (filter.to) qb.andWhere('event.eventDate <= :to', { to: filter.to });
    if (filter.search)
      qb.andWhere('event.name ILIKE :search', { search: `%${filter.search}%` });

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

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const eventDay = new Date(event.eventDate);
    eventDay.setHours(0, 0, 0, 0);

    if (eventDay < today) {
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
      metadata: { name },
    });
  }

  async deleteFutureRecurring(
    recurringEventId: string,
    actorId: string,
  ): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const events = await this.eventRepository
      .createQueryBuilder('event')
      .where('event.recurringEventId = :recurringEventId', { recurringEventId })
      .andWhere('event.eventDate >= :today', { today })
      .getMany();

    if (!events.length)
      throw new NotFoundException('No future recurring events found');

    const name = events[0]?.name;
    await this.eventRepository.remove(events);
    this.auditLogService.log('EVENT_DELETED', {
      actorId,
      metadata: {
        name,
        recurringEventId,
        count: events.length,
        isRecurring: true,
      },
    });
  }

  async findEventsReadyForAbsenceMarking(): Promise<Event[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return this.eventRepository
      .createQueryBuilder('event')
      .leftJoinAndSelect('event.serviceSlots', 'slot')
      .where('event.attendanceMarked = false')
      .andWhere('event.endDate < :today', { today })
      .andWhere(
        'EXISTS (SELECT 1 FROM service_slots s WHERE s.event_id = event.id)',
      )
      .getMany();
  }

  async getUpcomingEvents(limit = 5): Promise<Event[]> {
    // `eventDate` is a date-only column, so filtering on it alone treats an
    // event as "upcoming" for its entire calendar day even once every one of
    // its slots has actually finished (e.g. a 9am-1pm Sunday service still
    // showing as upcoming at 4pm). Fetch date-level candidates first (cheap),
    // then drop any whose slots have all already ended before taking `limit`.
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const candidates = await this.eventRepository.find({
      where: { eventDate: MoreThanOrEqual(startOfToday) },
      order: { eventDate: 'ASC' },
      relations: [
        'serviceSlots',
        'serviceSlots.config',
        'serviceSlots.config.defaultVenue',
        'serviceSlots.venueOverride',
      ],
    });

    const stillUpcoming = candidates.filter(
      (event) =>
        !event.serviceSlots?.length ||
        event.serviceSlots.some((slot) => new Date(slot.endTime) >= now),
    );

    return stillUpcoming.slice(0, limit);
  }

  resolveSlotConfig(slot: ServiceSlot): {
    workerCheckinStartOffsetSeconds: number;
    workerLateOffsetSeconds: number;
    memberCheckinStartOffsetSeconds: number;
    checkinStopOffsetSeconds: number;
    venue: Venue;
    allowedDistanceInMeters: number;
  } {
    const c = slot.config;
    if (!c)
      throw new BadRequestException(
        `Service slot "${slot.name}" has no config`,
      );

    const venue = slot.venueOverride ?? c.defaultVenue;
    if (!venue)
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
      venue,
      allowedDistanceInMeters:
        slot.allowedDistanceOverride ?? c.allowedDistanceInMeters,
    };
  }

  private async createSingle(dto: CreateEventDto): Promise<Event> {
    const slots = await this.buildSlots(dto.serviceSlots);
    const { eventDate, endDate } = this.deriveDateRange(slots);
    const event = this.eventRepository.create({
      name: dto.name,
      description: dto.description,
      eventDate,
      endDate,
      onlineAttendanceEnabled: dto.onlineAttendanceEnabled ?? false,
    });
    event.serviceSlots = slots;
    return this.eventRepository.save(event);
  }

  private async createRecurring(dto: CreateEventDto): Promise<Event[]> {
    const recurrenceEndDate = new Date(dto.recurrence.recurrenceEndDate);
    if (Number.isNaN(recurrenceEndDate.getTime()))
      throw new BadRequestException('Invalid recurrenceEndDate');

    const baseSlots = await this.buildSlots(dto.serviceSlots);
    const firstDate = this.truncateToUtcDate(
      new Date(Math.min(...baseSlots.map((s) => s.startTime.getTime()))),
    );

    const oneYearLater = new Date(firstDate);
    oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
    if (recurrenceEndDate > oneYearLater) {
      throw new BadRequestException(
        'Recurrence end date must be within one year of event start',
      );
    }

    const recurringEventId = uuidv4();
    const events: Event[] = [];
    let currentDate = firstDate;

    while (currentDate <= recurrenceEndDate) {
      const dateOffsetMs = currentDate.getTime() - firstDate.getTime();
      const adjustedSlotDtos = dto.serviceSlots.map((s) => ({
        ...s,
        startTime: new Date(
          new Date(s.startTime).getTime() + dateOffsetMs,
        ).toISOString(),
        endTime: new Date(
          new Date(s.endTime).getTime() + dateOffsetMs,
        ).toISOString(),
      }));
      const slots = await this.buildSlots(adjustedSlotDtos);
      const { eventDate, endDate } = this.deriveDateRange(slots);
      const event = this.eventRepository.create({
        name: dto.name,
        description: dto.description,
        eventDate,
        endDate,
        recurringEventId,
        onlineAttendanceEnabled: dto.onlineAttendanceEnabled ?? false,
      });
      event.serviceSlots = slots;
      events.push(event);
      currentDate = this.advanceDate(
        currentDate,
        dto.recurrence.recurrencePattern,
        dto.recurrence.recurrenceInterval,
      );
    }

    return this.eventRepository.save(events);
  }

  /** Event.eventDate/endDate are derived from the slots, not entered independently. */
  private deriveDateRange(slots: ServiceSlot[]): {
    eventDate: Date;
    endDate: Date;
  } {
    return {
      eventDate: this.truncateToUtcDate(
        new Date(Math.min(...slots.map((s) => s.startTime.getTime()))),
      ),
      endDate: this.truncateToUtcDate(
        new Date(Math.max(...slots.map((s) => s.endTime.getTime()))),
      ),
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

    return this.slotRepository.create({
      name: dto.name ?? 'Service',
      startTime: start,
      endTime: end,
      config,
      workerCheckinStartOverride: dto.workerCheckinStartOverride ?? null,
      workerLateOverride: dto.workerLateOverride ?? null,
      memberCheckinStartOverride: dto.memberCheckinStartOverride ?? null,
      checkinStopOverride: dto.checkinStopOverride ?? null,
      allowedDistanceOverride: dto.allowedDistanceOverride ?? null,
      venueOverride,
    });
  }

  private async attachMyAttendance(
    events: Event[],
    memberId: string,
  ): Promise<void> {
    const eventIds = events.map((e) => e.id);
    if (!eventIds.length) return;

    const rows = await this.dataSource
      .createQueryBuilder()
      .select('a.event_id', 'eventId')
      .addSelect('a.service_slot_id', 'slotId')
      .addSelect('a.status', 'status')
      .addSelect('a.checkin_time', 'checkinTime')
      .from('attendances', 'a')
      .where('a.member_id = :memberId', { memberId })
      .andWhere('a.event_id IN (:...eventIds)', { eventIds })
      .andWhere(`a.status IN ('PRESENT', 'LATE')`)
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

  private advanceDate(date: Date, pattern: string, interval: number): Date {
    switch (pattern) {
      case 'daily':
        return addDays(date, interval);
      case 'weekly':
        return addWeeks(date, interval);
      case 'monthly':
        return addMonths(date, interval);
      default:
        throw new BadRequestException(`Unknown recurrence pattern: ${pattern}`);
    }
  }
}
