import { formatInTimeZone } from 'date-fns-tz';
import { Event } from '../../event/entity/event.entity';
import { EventAudienceEnum } from '../../event/enums/event-audience.enum';
import { eventVisibleToViewerSql } from '../../event/utility/event-audience';
import { ChurchTimezoneService } from '../../event/service/church-timezone.service';
import type { EventViewer } from '../../event/service/event.service';
import { CalendarRepeatDisplay } from '../entity/church-calendar.entity';
import {
  CalendarOccurrence,
  buildCalendarItems,
  eventKey,
  repeatLabel,
} from '../util/calendar-items';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import 'multer';
import { ChurchCalendar } from '../entity/church-calendar.entity';
import {
  ChurchCalendarEntryDto,
  CreateChurchCalendarDto,
  UpdateChurchCalendarDto,
} from '../dto/church-calendar.dto';
import { CloudinaryService } from '../../utility/service/cloudinary.service';
import { DateService } from '../../utility/service/date.service';

// Who the list is for: a member (sees only events meant for them), the public, or an admin (sees all).
export interface CalendarScope {
  viewer?: EventViewer;
  publicOnly?: boolean;
  includeHidden?: boolean;
}

export interface CalendarEventOption {
  key: string;
  title: string;
  date: string;
  time: string;
  repeatLabel?: string;
  count: number;
  hidden: boolean;
}

@Injectable()
export class ChurchCalendarService {
  constructor(
    @InjectRepository(ChurchCalendar)
    private readonly calendarRepo: Repository<ChurchCalendar>,
    private readonly cloudinaryService: CloudinaryService,
    private readonly dateService: DateService,
    @InjectRepository(Event)
    private readonly eventRepo: Repository<Event>,
    private readonly churchTimezone: ChurchTimezoneService,
  ) {}

  // Events in the calendar's range, as church-local date/time, minus any the admin hid.
  async occurrences(
    calendar: ChurchCalendar,
    scope: CalendarScope,
  ): Promise<CalendarOccurrence[]> {
    if (!calendar.includeEvents) return [];
    const tz = await this.churchTimezone.get();
    const qb = this.eventRepo
      .createQueryBuilder('event')
      .select([
        'event.id',
        'event.name',
        'event.description',
        'event.startTime',
        'event.recurringEventId',
      ])
      // A day either side covers any timezone; the exact local-date check follows.
      .where('event.startTime >= :from AND event.startTime < :to', {
        from: new Date(
          Date.parse(`${calendar.startDate}T00:00:00Z`) - 86_400_000,
        ),
        to: new Date(
          Date.parse(`${calendar.endDate}T00:00:00Z`) + 2 * 86_400_000,
        ),
      })
      .orderBy('event.startTime', 'ASC');
    if (scope.viewer) {
      qb.andWhere(eventVisibleToViewerSql('event'), {
        viewerId: scope.viewer.id,
        viewerIsWorker: scope.viewer.isWorker,
      });
    } else if (scope.publicOnly) {
      qb.andWhere('event.audience = :everyone', {
        everyone: EventAudienceEnum.EVERYONE,
      });
    }
    const hidden = new Set(
      scope.includeHidden ? [] : (calendar.hiddenEventKeys ?? []),
    );
    return (await qb.getMany())
      .map((e) => ({
        eventId: e.id,
        seriesId: e.recurringEventId ?? null,
        title: e.name,
        description: e.description,
        date: formatInTimeZone(e.startTime, tz, 'yyyy-MM-dd'),
        time: formatInTimeZone(e.startTime, tz, 'HH:mm'),
      }))
      .filter(
        (o) =>
          o.date >= calendar.startDate &&
          o.date <= calendar.endDate &&
          !hidden.has(eventKey(o)),
      );
  }

  async withItems(
    calendar: ChurchCalendar,
    scope: CalendarScope,
  ): Promise<ChurchCalendar> {
    calendar.items = buildCalendarItems(
      calendar.entries ?? [],
      await this.occurrences(calendar, scope),
      calendar.repeatDisplay ?? CalendarRepeatDisplay.SUMMARY,
    );
    return calendar;
  }

  // For the admin editor: each event (or repeating service) in range, and whether it's hidden.
  async eventOptions(calendar: ChurchCalendar): Promise<CalendarEventOption[]> {
    const all = await this.occurrences(
      { ...calendar, includeEvents: true } as ChurchCalendar,
      { includeHidden: true },
    );
    const hidden = new Set(calendar.hiddenEventKeys ?? []);
    const groups = new Map<string, CalendarOccurrence[]>();
    all.forEach((o) =>
      groups.set(eventKey(o), [...(groups.get(eventKey(o)) ?? []), o]),
    );
    return [...groups.entries()].map(([key, list]) => ({
      key,
      title: list[0].title,
      date: list[0].date,
      time: list[0].time,
      repeatLabel:
        list.length > 1 ? repeatLabel(list.map((o) => o.date)) : undefined,
      count: list.length,
      hidden: hidden.has(key),
    }));
  }

  async create(dto: CreateChurchCalendarDto): Promise<ChurchCalendar> {
    this.assertValidRange(dto.startDate, dto.endDate);
    this.assertValidEntries(dto.entries, dto.startDate, dto.endDate);
    const calendar = this.calendarRepo.create({
      title: dto.title,
      theme: dto.theme ?? null,
      startDate: dto.startDate,
      endDate: dto.endDate,
      accentColor: dto.accentColor ?? null,
      isPublished: dto.isPublished ?? false,
      entries: this.sortEntries(dto.entries),
      includeEvents: dto.includeEvents ?? true,
      repeatDisplay: dto.repeatDisplay ?? CalendarRepeatDisplay.SUMMARY,
      hiddenEventKeys: dto.hiddenEventKeys ?? [],
    });
    return this.calendarRepo.save(calendar);
  }

  async getAll(): Promise<ChurchCalendar[]> {
    return this.calendarRepo.find({ order: { startDate: 'DESC' } });
  }

  // The admin editor's view: everything in range (all audiences), plus the events it can hide.
  async getForAdmin(
    id: string,
  ): Promise<ChurchCalendar & { eventOptions: CalendarEventOption[] }> {
    return this.forAdmin(await this.getById(id));
  }

  async forAdmin(
    calendar: ChurchCalendar,
  ): Promise<ChurchCalendar & { eventOptions: CalendarEventOption[] }> {
    const withItems = await this.withItems(calendar, {});
    return Object.assign(withItems, {
      eventOptions: await this.eventOptions(calendar),
    });
  }

  async getById(id: string): Promise<ChurchCalendar> {
    const calendar = await this.calendarRepo.findOneBy({ id });
    if (!calendar) throw new NotFoundException('Church calendar not found');
    return calendar;
  }

  // Only published calendars still covering "today or later" are ever
  // returned here — a calendar whose endDate has already passed simply
  // stops appearing for members without an admin needing to unpublish it.
  // Ordered by startDate so a shorter-range "this month" calendar and a
  // longer-running "this year" one can both surface together, earliest
  // first.
  async getCurrentForMember(viewer?: EventViewer): Promise<ChurchCalendar[]> {
    const today = this.dateService.today();
    const calendars = await this.calendarRepo.find({
      where: { isPublished: true, endDate: MoreThanOrEqual(today) },
      order: { startDate: 'ASC' },
    });
    return Promise.all(calendars.map((c) => this.withItems(c, { viewer })));
  }

  async update(
    id: string,
    dto: UpdateChurchCalendarDto,
  ): Promise<ChurchCalendar> {
    const calendar = await this.getById(id);

    const nextStartDate = dto.startDate ?? calendar.startDate;
    const nextEndDate = dto.endDate ?? calendar.endDate;
    if (dto.startDate !== undefined || dto.endDate !== undefined) {
      this.assertValidRange(nextStartDate, nextEndDate);
    }

    if (dto.title !== undefined) calendar.title = dto.title;
    if (dto.theme !== undefined) calendar.theme = dto.theme;
    if (dto.startDate !== undefined) calendar.startDate = dto.startDate;
    if (dto.endDate !== undefined) calendar.endDate = dto.endDate;
    if (dto.accentColor !== undefined) {
      calendar.accentColor = dto.accentColor;
    }
    if (dto.isPublished !== undefined) calendar.isPublished = dto.isPublished;
    if (dto.includeEvents !== undefined)
      calendar.includeEvents = dto.includeEvents;
    if (dto.repeatDisplay !== undefined)
      calendar.repeatDisplay = dto.repeatDisplay;
    if (dto.hiddenEventKeys !== undefined)
      calendar.hiddenEventKeys = dto.hiddenEventKeys;
    if (dto.entries !== undefined) {
      this.assertValidEntries(dto.entries, nextStartDate, nextEndDate);
      calendar.entries = this.sortEntries(dto.entries);
    }

    return this.calendarRepo.save(calendar);
  }

  async delete(id: string): Promise<void> {
    const calendar = await this.getById(id);
    await this.calendarRepo.remove(calendar);
  }

  // Generic upload used by every entry's photo slot — returns a reference
  // only, doesn't touch the ChurchCalendar row itself; the caller embeds the
  // url into whichever entry it belongs to on the next save. Same posture
  // as PageService.uploadSectionImage: admin-only, so the volume of an
  // abandoned upload (started, edit never saved) is low enough that no
  // orphan-cleanup sweep is built for v1.
  async uploadEntryImage(
    id: string,
    file: Express.Multer.File,
  ): Promise<{ url: string; publicId: string }> {
    await this.getById(id);
    const uploaded = await this.cloudinaryService.uploadBuffer(
      file.buffer,
      'church-calendar-images',
      undefined,
      file.mimetype,
    );
    return { url: uploaded.secureUrl, publicId: uploaded.publicId };
  }

  private assertValidRange(startDate: string, endDate: string): void {
    if (endDate < startDate) {
      throw new BadRequestException('endDate must not be before startDate');
    }
  }

  private assertValidEntries(
    entries: ChurchCalendarEntryDto[],
    startDate: string,
    endDate: string,
  ): void {
    entries.forEach((entry, index) => {
      const label = `Entry #${index + 1}`;
      if (entry.date < startDate || entry.date > endDate) {
        throw new BadRequestException(
          `${label}: date must be between ${startDate} and ${endDate}`,
        );
      }
      if (!entry.title.trim()) {
        throw new BadRequestException(`${label}: title is required`);
      }
    });
  }

  private sortEntries(
    entries: ChurchCalendarEntryDto[],
  ): ChurchCalendarEntryDto[] {
    return [...entries].sort((a, b) => a.date.localeCompare(b.date));
  }
}
