import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GivingOption } from '../entity/giving-option.entity';
import { Fund } from '../entity/fund.entity';
import {
  CreateGivingOptionDto,
  UpdateGivingOptionDto,
} from '../dto/giving-option.dto';
import { Admin } from '../../admin/entity/admin.entity';
import { AuditLogService } from '../../utility/service/audit-log.service';

@Injectable()
export class GivingOptionService {
  constructor(
    @InjectRepository(GivingOption)
    private readonly givingOptionRepo: Repository<GivingOption>,
    @InjectRepository(Fund)
    private readonly fundRepo: Repository<Fund>,
    private readonly auditLogService: AuditLogService,
  ) {}

  private async resolveFund(fundId?: string): Promise<Fund | null> {
    if (!fundId) return null;
    const fund = await this.fundRepo.findOne({ where: { id: fundId } });
    if (!fund) throw new NotFoundException('Fund not found.');
    return fund;
  }

  async create(
    dto: CreateGivingOptionDto,
    admin: Admin,
  ): Promise<GivingOption> {
    const existing = await this.givingOptionRepo.findOne({
      where: { name: dto.name },
    });
    if (existing)
      throw new ConflictException(
        `A giving option named '${dto.name}' already exists.`,
      );

    const fund = await this.resolveFund(dto.fundId);
    const givingOption = this.givingOptionRepo.create({
      name: dto.name,
      description: dto.description ?? null,
      fund,
    });
    const saved = await this.givingOptionRepo.save(givingOption);
    this.auditLogService.log('GIVING_OPTION_CREATED', {
      actorId: admin.id,
      targetId: saved.id,
      metadata: { name: saved.name },
    });
    return saved;
  }

  async findAll(): Promise<GivingOption[]> {
    return this.givingOptionRepo.find({
      relations: ['fund'],
      order: { name: 'ASC' },
    });
  }

  async findAllActive(): Promise<GivingOption[]> {
    return this.givingOptionRepo.find({
      where: { isActive: true },
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string): Promise<GivingOption> {
    const givingOption = await this.givingOptionRepo.findOne({
      where: { id },
      relations: ['fund'],
    });
    if (!givingOption) throw new NotFoundException('Giving option not found.');
    return givingOption;
  }

  async update(
    id: string,
    dto: UpdateGivingOptionDto,
    admin: Admin,
  ): Promise<GivingOption> {
    const givingOption = await this.findOne(id);
    const fund =
      dto.fundId !== undefined
        ? await this.resolveFund(dto.fundId)
        : givingOption.fund;
    Object.assign(givingOption, {
      name: dto.name ?? givingOption.name,
      description: dto.description ?? givingOption.description,
      isActive: dto.isActive ?? givingOption.isActive,
      fund,
    });
    const saved = await this.givingOptionRepo.save(givingOption);
    this.auditLogService.log('GIVING_OPTION_UPDATED', {
      actorId: admin.id,
      targetId: saved.id,
      metadata: dto as unknown as Record<string, unknown>,
    });
    return saved;
  }
}
