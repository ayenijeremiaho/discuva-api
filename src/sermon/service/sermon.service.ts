import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Sermon } from '../entity/sermon.entity';
import { CreateSermonDto, UpdateSermonDto } from '../dto/sermon.dto';
import { AnnounceLiveDto } from '../dto/announce-live.dto';
import { LivePlatformEnum } from '../enum/live-platform.enum';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import { UtilityService } from '../../utility/service/utility.service';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { AnnouncementService } from '../../announcement/service/announcement.service';
import { Admin } from '../../admin/entity/admin.entity';

const PLATFORM_LABEL: Record<LivePlatformEnum, string> = {
  [LivePlatformEnum.YOUTUBE]: 'YouTube',
  [LivePlatformEnum.MIXLR]: 'Mixlr',
};

@Injectable()
export class SermonService {
  constructor(
    @InjectRepository(Sermon)
    private readonly sermonRepo: Repository<Sermon>,
    private readonly auditLogService: AuditLogService,
    private readonly announcementService: AnnouncementService,
  ) {}

  async create(dto: CreateSermonDto, admin: Admin): Promise<Sermon> {
    if (!dto.youtubeUrl && !dto.mixlrUrl) {
      throw new BadRequestException(
        'At least one of youtubeUrl or mixlrUrl is required',
      );
    }

    const sermon = this.sermonRepo.create({
      title: dto.title,
      speakerName: dto.speakerName,
      date: new Date(dto.date),
      description: dto.description ?? null,
      youtubeUrl: dto.youtubeUrl ?? null,
      mixlrUrl: dto.mixlrUrl ?? null,
      series: dto.series ?? null,
      createdBy: { id: admin.id } as Admin,
    });

    const saved = await this.sermonRepo.save(sermon);
    this.auditLogService.log('SERMON_CREATED', {
      actorId: admin.id,
      targetId: saved.id,
      metadata: { title: saved.title },
    });
    return saved;
  }

  async update(
    id: string,
    dto: UpdateSermonDto,
    admin: Admin,
  ): Promise<Sermon> {
    const sermon = await this.getOrThrow(id);

    if (dto.title !== undefined) sermon.title = dto.title;
    if (dto.speakerName !== undefined) sermon.speakerName = dto.speakerName;
    if (dto.date !== undefined) sermon.date = new Date(dto.date);
    if (dto.description !== undefined) sermon.description = dto.description;
    if (dto.youtubeUrl !== undefined) sermon.youtubeUrl = dto.youtubeUrl;
    if (dto.mixlrUrl !== undefined) sermon.mixlrUrl = dto.mixlrUrl;
    if (dto.series !== undefined) sermon.series = dto.series;

    if (!sermon.youtubeUrl && !sermon.mixlrUrl) {
      throw new BadRequestException(
        'At least one of youtubeUrl or mixlrUrl is required',
      );
    }

    const saved = await this.sermonRepo.save(sermon);
    this.auditLogService.log('SERMON_UPDATED', {
      actorId: admin.id,
      targetId: id,
      metadata: { title: saved.title, changes: Object.keys(dto) },
    });
    return saved;
  }

  async delete(id: string, admin: Admin): Promise<void> {
    const sermon = await this.getOrThrow(id);
    const { title } = sermon;
    await this.sermonRepo.remove(sermon);
    this.auditLogService.log('SERMON_DELETED', {
      actorId: admin.id,
      targetId: id,
      metadata: { title },
    });
  }

  async findAll(
    page = 1,
    limit = 20,
    series?: string,
  ): Promise<PaginationResponseDto<Sermon>> {
    const [sermons, total] = await this.sermonRepo.findAndCount({
      where: series ? { series } : {},
      order: { date: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return UtilityService.createPaginationResponse(sermons, page, limit, total);
  }

  async findOne(id: string): Promise<Sermon> {
    return this.getOrThrow(id);
  }

  async announceLive(dto: AnnounceLiveDto, admin: Admin): Promise<void> {
    const title = dto.title ?? `🔴 Live Now on ${PLATFORM_LABEL[dto.platform]}`;
    const body = `We're live now — tap to watch.\n\n${dto.url}`;
    await this.announcementService.createSystemAnnouncement(
      title,
      body,
      admin.id,
    );
  }

  private async getOrThrow(id: string): Promise<Sermon> {
    const sermon = await this.sermonRepo.findOne({ where: { id } });
    if (!sermon) throw new NotFoundException('Sermon not found');
    return sermon;
  }
}
