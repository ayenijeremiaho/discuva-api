import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ClergyTitle } from '../entity/clergy-title.entity';
import { Clergy } from '../../member/entity/clergy.entity';
import { CreateClergyTitleDto } from '../dto/create-clergy-title.dto';
import { UpdateClergyTitleDto } from '../dto/update-clergy-title.dto';
import { CacheService } from '../../utility/service/cache.service';
import { AuditLogService } from '../../utility/service/audit-log.service';

@Injectable()
export class ClergyTitleService {
  private static readonly CACHE_KEY = 'clergy-titles:all';
  private readonly cacheTtl: number;

  constructor(
    @InjectRepository(ClergyTitle)
    private readonly clergyTitleRepository: Repository<ClergyTitle>,
    @InjectRepository(Clergy)
    private readonly clergyRepository: Repository<Clergy>,
    private readonly cacheService: CacheService,
    private readonly configService: ConfigService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.cacheTtl = this.configService.get<number>(
      'CACHE_TTL_REFERENCE_SECONDS',
    );
  }

  async create(
    dto: CreateClergyTitleDto,
    actorId: string,
  ): Promise<ClergyTitle> {
    await this.assertNameUnique(dto.name);
    const title = await this.clergyTitleRepository.save({ ...dto });
    this.cacheService.del(ClergyTitleService.CACHE_KEY);
    this.auditLogService.log('CLERGY_TITLE_CREATED', {
      actorId,
      targetId: title.id,
      targetName: title.name,
      metadata: { name: title.name },
    });
    return title;
  }

  async getOne(id: string): Promise<ClergyTitle> {
    return this.getClergyTitleOrThrow(id);
  }

  async getAll(): Promise<ClergyTitle[]> {
    let all = await this.cacheService.get<ClergyTitle[]>(
      ClergyTitleService.CACHE_KEY,
    );
    if (!all) {
      all = await this.clergyTitleRepository.find({
        order: { createdAt: 'DESC' },
      });
      this.cacheService.set(ClergyTitleService.CACHE_KEY, all, this.cacheTtl);
    }
    return all;
  }

  async update(
    id: string,
    dto: UpdateClergyTitleDto,
    actorId: string,
  ): Promise<ClergyTitle> {
    const title = await this.getClergyTitleOrThrow(id);

    if (dto.name && dto.name !== title.name) {
      await this.assertNameUnique(dto.name);
      title.name = dto.name;
    }
    if ('description' in dto) title.description = dto.description ?? null;

    const updated = await this.clergyTitleRepository.save(title);
    this.cacheService.del(ClergyTitleService.CACHE_KEY);
    this.auditLogService.log('CLERGY_TITLE_UPDATED', {
      actorId,
      targetId: id,
      targetName: updated.name,
      metadata: { name: updated.name, changes: Object.keys(dto) },
    });
    return updated;
  }

  async delete(id: string, actorId: string): Promise<void> {
    const title = await this.getClergyTitleOrThrow(id);

    const inUse = await this.clergyRepository.exists({
      where: { title: { id } },
    });
    if (inUse) {
      throw new BadRequestException(
        `${title.name} is assigned to one or more clergy and cannot be deleted`,
      );
    }

    const { name } = title;
    await this.clergyTitleRepository.delete(id);
    this.cacheService.del(ClergyTitleService.CACHE_KEY);
    this.auditLogService.log('CLERGY_TITLE_DELETED', {
      actorId,
      targetId: id,
      targetName: name,
      metadata: { name },
    });
  }

  private async assertNameUnique(name: string): Promise<void> {
    const exists = await this.clergyTitleRepository.existsBy({ name });
    if (exists) {
      throw new BadRequestException('Clergy title name already exists');
    }
  }

  private async getClergyTitleOrThrow(id: string): Promise<ClergyTitle> {
    const title = await this.clergyTitleRepository.findOneBy({ id });
    if (!title) {
      throw new NotFoundException('Clergy title not found');
    }
    return title;
  }
}
