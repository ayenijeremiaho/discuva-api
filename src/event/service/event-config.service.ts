import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventConfig } from '../entity/event-config.entity';
import { CreateEventConfigDto } from '../dto/create-event-config.dto';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { UtilityService } from '../../utility/service/utility.service';
import { ConfigService } from '@nestjs/config';
import { VenueService } from '../../venue/service/venue.service';
import { CacheService } from '../../utility/service/cache.service';
import { UpdateEventConfigDto } from '../dto/update-event-config.dto';
import { MeetingFormatEnum } from '../../utility/enum/meeting-format.enum';
import { Venue } from '../../venue/entity/venue.entity';

@Injectable()
export class EventConfigService {
  private static readonly CACHE_KEY = 'event-config:all';
  private readonly logger = new Logger(EventConfigService.name);
  private readonly cacheTtl: number;

  constructor(
    @InjectRepository(EventConfig)
    private readonly repo: Repository<EventConfig>,
    private readonly venueService: VenueService,
    private readonly cacheService: CacheService,
    private readonly configService: ConfigService,
  ) {
    this.cacheTtl = this.configService.get<number>(
      'CACHE_TTL_REFERENCE_SECONDS',
    );
  }

  async create(dto: CreateEventConfigDto): Promise<EventConfig> {
    if (await this.repo.exists({ where: { name: dto.name } })) {
      throw new BadRequestException('Event config name already in use');
    }
    this.validateOffsets(dto);
    const format = dto.defaultFormat ?? MeetingFormatEnum.IN_PERSON;
    this.assertValidFormat(format, dto.defaultVenueId);

    const defaultVenue = dto.defaultVenueId
      ? await this.venueService.getById(dto.defaultVenueId)
      : null;

    const config = this.repo.create({
      name: dto.name,
      description: dto.description,
      workerCheckinStartOffsetSeconds: dto.workerCheckinStartOffsetSeconds,
      workerLateOffsetSeconds: dto.workerLateOffsetSeconds,
      memberCheckinStartOffsetSeconds: dto.memberCheckinStartOffsetSeconds,
      checkinStopOffsetSeconds: dto.checkinStopOffsetSeconds,
      allowedDistanceInMeters: dto.allowedDistanceInMeters,
      autoStartSession: dto.autoStartSession ?? false,
      defaultVenue,
      defaultFormat: format,
      onlineMeetingUrl: dto.onlineMeetingUrl ?? null,
    });
    const saved = await this.repo.save(config);
    this.cacheService.del(EventConfigService.CACHE_KEY);
    this.logger.log(`Created event config "${saved.name}" (${saved.id})`);
    return saved;
  }

  async update(id: string, dto: UpdateEventConfigDto): Promise<EventConfig> {
    const config = await this.get(id);

    if (dto.name && dto.name !== config.name) {
      if (await this.repo.exists({ where: { name: dto.name } })) {
        throw new BadRequestException('Event config name already in use');
      }
    }

    let venue: Venue | null = config.defaultVenue;
    if (dto.defaultVenueId !== undefined) {
      venue = dto.defaultVenueId
        ? await this.venueService.getById(dto.defaultVenueId)
        : null;
    }
    const format = dto.defaultFormat ?? config.defaultFormat;
    this.assertValidFormat(format, venue?.id);
    config.defaultVenue = venue;

    const { defaultVenueId: _dv, ...rest } = dto;
    Object.assign(config, rest);
    this.validateOffsets(config);
    const saved = await this.repo.save(config);
    this.cacheService.del(EventConfigService.CACHE_KEY);
    this.logger.log(`Updated event config "${saved.name}" (${id})`);
    return saved;
  }

  private assertValidFormat(
    format: MeetingFormatEnum,
    venueId: string | null | undefined,
  ): void {
    if (format === MeetingFormatEnum.IN_PERSON && !venueId) {
      throw new BadRequestException(
        'An in-person event config requires a default venue',
      );
    }
    if (format === MeetingFormatEnum.ONLINE && venueId) {
      throw new BadRequestException(
        'An online event config cannot have a default venue',
      );
    }
  }

  async get(id: string): Promise<EventConfig> {
    const config = await this.repo.findOne({
      where: { id },
      relations: ['defaultVenue'],
    });
    if (!config) throw new NotFoundException('Event config not found');
    return config;
  }

  async getAll(
    page = 1,
    limit = 10,
  ): Promise<PaginationResponseDto<EventConfig>> {
    if (page < 1) throw new BadRequestException('Page must be greater than 0');
    let all = await this.cacheService.get<EventConfig[]>(
      EventConfigService.CACHE_KEY,
    );
    if (!all) {
      all = await this.repo.find({
        order: { createdAt: 'DESC' },
        relations: ['defaultVenue'],
      });
      this.cacheService.set(EventConfigService.CACHE_KEY, all, this.cacheTtl);
    }
    const total = all.length;
    const slice = all.slice((page - 1) * limit, page * limit);
    return UtilityService.createPaginationResponse(slice, page, limit, total);
  }

  async delete(id: string): Promise<void> {
    const config = await this.repo.findOne({
      where: { id },
      relations: ['serviceSlots'],
    });

    if (!config) throw new NotFoundException('Event config not found');

    if (config.serviceSlots?.length > 0) {
      throw new BadRequestException(
        'Cannot delete a config that is assigned to service slots',
      );
    }

    await this.repo.remove(config);
    this.cacheService.del(EventConfigService.CACHE_KEY);
    this.logger.log(`Deleted event config "${config.name}" (${id})`);
  }

  private validateOffsets(cfg: {
    workerCheckinStartOffsetSeconds: number;
    workerLateOffsetSeconds: number;
    memberCheckinStartOffsetSeconds: number;
    checkinStopOffsetSeconds: number;
  }): void {
    if (cfg.workerCheckinStartOffsetSeconds >= 0) {
      throw new BadRequestException(
        'Worker check-in must open before the service starts',
      );
    }
    if (cfg.memberCheckinStartOffsetSeconds >= 0) {
      throw new BadRequestException(
        'Member check-in must open before the service starts',
      );
    }
    if (cfg.workerLateOffsetSeconds <= cfg.workerCheckinStartOffsetSeconds) {
      throw new BadRequestException(
        'Workers cannot be marked late before check-in has even opened',
      );
    }
    if (cfg.checkinStopOffsetSeconds <= cfg.workerLateOffsetSeconds) {
      throw new BadRequestException(
        'Check-in must close after the late threshold',
      );
    }
  }
}
