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

@Injectable()
export class ChurchCalendarService {
  constructor(
    @InjectRepository(ChurchCalendar)
    private readonly calendarRepo: Repository<ChurchCalendar>,
    private readonly cloudinaryService: CloudinaryService,
    private readonly dateService: DateService,
  ) {}

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
    });
    return this.calendarRepo.save(calendar);
  }

  async getAll(): Promise<ChurchCalendar[]> {
    return this.calendarRepo.find({ order: { startDate: 'DESC' } });
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
  async getCurrentForMember(): Promise<ChurchCalendar[]> {
    const today = this.dateService.today();
    return this.calendarRepo.find({
      where: { isPublished: true, endDate: MoreThanOrEqual(today) },
      order: { startDate: 'ASC' },
    });
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
