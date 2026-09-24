import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Fund } from '../entity/fund.entity';
import { CreateFundDto, UpdateFundDto } from '../dto/fund.dto';
import { Admin } from '../../admin/entity/admin.entity';
import { AuditLogService } from '../../utility/service/audit-log.service';

@Injectable()
export class FundService {
  constructor(
    @InjectRepository(Fund)
    private readonly fundRepo: Repository<Fund>,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(dto: CreateFundDto, admin: Admin): Promise<Fund> {
    const existing = await this.fundRepo.findOne({ where: { name: dto.name } });
    if (existing)
      throw new ConflictException(`A fund named '${dto.name}' already exists.`);

    const fund = this.fundRepo.create({
      name: dto.name,
      type: dto.type,
      description: dto.description ?? null,
    });
    const saved = await this.fundRepo.save(fund);
    this.auditLogService.log('FUND_CREATED', {
      actorId: admin.id,
      targetId: saved.id,
      targetName: saved.name,
      metadata: { name: saved.name, type: saved.type },
    });
    return saved;
  }

  async findAll(): Promise<Fund[]> {
    return this.fundRepo.find({ order: { name: 'ASC' } });
  }

  async findOne(id: string): Promise<Fund> {
    const fund = await this.fundRepo.findOne({ where: { id } });
    if (!fund) throw new NotFoundException('Fund not found.');
    return fund;
  }

  async update(id: string, dto: UpdateFundDto, admin: Admin): Promise<Fund> {
    const fund = await this.findOne(id);
    Object.assign(fund, {
      name: dto.name ?? fund.name,
      description: dto.description ?? fund.description,
      isActive: dto.isActive ?? fund.isActive,
    });
    const saved = await this.fundRepo.save(fund);
    this.auditLogService.log('FUND_UPDATED', {
      actorId: admin.id,
      targetId: saved.id,
      targetName: saved.name,
      metadata: dto as unknown as Record<string, unknown>,
    });
    return saved;
  }
}
