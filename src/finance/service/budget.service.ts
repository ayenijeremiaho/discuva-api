import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Budget } from '../entity/budget.entity';
import {
  BudgetQueryDto,
  CreateBudgetDto,
  UpdateBudgetDto,
} from '../dto/budget.dto';
import { Admin } from '../../admin/entity/admin.entity';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';

@Injectable()
export class BudgetService {
  constructor(
    @InjectRepository(Budget)
    private readonly budgetRepo: Repository<Budget>,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(dto: CreateBudgetDto, admin: Admin): Promise<Budget> {
    const budget = this.budgetRepo.create({
      name: dto.name,
      fund: { id: dto.fundId } as any,
      account: { id: dto.accountId } as any,
      period: dto.period,
      amount: dto.amount,
      startDate: dto.startDate,
      endDate: dto.endDate,
      createdBy: { id: admin.id } as any,
    });
    const saved = await this.budgetRepo.save(budget);
    this.auditLogService.log('BUDGET_CREATED', {
      actorId: admin.id,
      targetId: saved.id,
      metadata: { name: saved.name },
    });
    return saved;
  }

  async findAll(query: BudgetQueryDto): Promise<PaginationResponseDto<Budget>> {
    const { page = 1, limit = 20, fundId, period, isActive } = query;
    const qb = this.budgetRepo
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.fund', 'fund')
      .leftJoinAndSelect('b.account', 'account')
      .orderBy('b.startDate', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (fundId) qb.andWhere('fund.id = :fundId', { fundId });
    if (period) qb.andWhere('b.period = :period', { period });
    if (isActive !== undefined)
      qb.andWhere('b.isActive = :isActive', { isActive });

    const [data, totalCount] = await qb.getManyAndCount();
    return {
      data,
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async findOne(id: string): Promise<Budget> {
    const budget = await this.budgetRepo.findOne({
      where: { id },
      relations: ['fund', 'account', 'createdBy'],
    });
    if (!budget) throw new NotFoundException('Budget not found.');
    return budget;
  }

  async update(id: string, dto: UpdateBudgetDto): Promise<Budget> {
    const budget = await this.findOne(id);
    if (dto.name !== undefined) budget.name = dto.name;
    if (dto.amount !== undefined) budget.amount = dto.amount;
    if (dto.startDate !== undefined) budget.startDate = dto.startDate;
    if (dto.endDate !== undefined) budget.endDate = dto.endDate;
    return this.budgetRepo.save(budget);
  }

  async deactivate(id: string, admin: Admin): Promise<Budget> {
    const budget = await this.findOne(id);
    budget.isActive = false;
    const saved = await this.budgetRepo.save(budget);
    this.auditLogService.log('BUDGET_DEACTIVATED', {
      actorId: admin.id,
      targetId: saved.id,
    });
    return saved;
  }

  async reactivate(id: string, admin: Admin): Promise<Budget> {
    const budget = await this.findOne(id);
    budget.isActive = true;
    const saved = await this.budgetRepo.save(budget);
    this.auditLogService.log('BUDGET_REACTIVATED', {
      actorId: admin.id,
      targetId: saved.id,
    });
    return saved;
  }
}
