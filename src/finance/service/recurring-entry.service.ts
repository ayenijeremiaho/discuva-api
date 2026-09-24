import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RecurringEntry } from '../entity/recurring-entry.entity';
import {
  CreateRecurringEntryDto,
  UpdateRecurringEntryDto,
} from '../dto/recurring-entry.dto';
import { Admin } from '../../admin/entity/admin.entity';
import { AuditLogService } from '../../utility/service/audit-log.service';

@Injectable()
export class RecurringEntryService {
  constructor(
    @InjectRepository(RecurringEntry)
    private readonly recurringRepo: Repository<RecurringEntry>,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(
    dto: CreateRecurringEntryDto,
    admin: Admin,
  ): Promise<RecurringEntry> {
    const entry = this.recurringRepo.create({
      description: dto.description,
      debitAccount: { id: dto.debitAccountId } as any,
      creditAccount: { id: dto.creditAccountId } as any,
      amount: dto.amount,
      frequency: dto.frequency,
      fund: { id: dto.fundId } as any,
      nextDueAt: new Date(dto.nextDueAt),
      createdBy: { id: admin.id } as any,
    });
    const saved = await this.recurringRepo.save(entry);
    this.auditLogService.log('RECURRING_ENTRY_CREATED', {
      actorId: admin.id,
      targetId: saved.id,
      targetName: saved.description,
      metadata: { description: saved.description },
    });
    return saved;
  }

  async findAll(): Promise<RecurringEntry[]> {
    return this.recurringRepo.find({
      relations: ['debitAccount', 'creditAccount', 'fund', 'createdBy'],
      order: { nextDueAt: 'ASC' },
    });
  }

  async findOne(id: string): Promise<RecurringEntry> {
    const entry = await this.recurringRepo.findOne({
      where: { id },
      relations: ['debitAccount', 'creditAccount', 'fund', 'createdBy'],
    });
    if (!entry) throw new NotFoundException('Recurring entry not found.');
    return entry;
  }

  async update(
    id: string,
    dto: UpdateRecurringEntryDto,
    admin: Admin,
  ): Promise<RecurringEntry> {
    const entry = await this.findOne(id);
    Object.assign(entry, {
      description: dto.description ?? entry.description,
      amount: dto.amount ?? entry.amount,
      nextDueAt: dto.nextDueAt ? new Date(dto.nextDueAt) : entry.nextDueAt,
      isActive: dto.isActive !== undefined ? dto.isActive : entry.isActive,
    });
    const saved = await this.recurringRepo.save(entry);
    this.auditLogService.log('RECURRING_ENTRY_UPDATED', {
      actorId: admin.id,
      targetId: saved.id,
      targetName: saved.description,
      metadata: dto as unknown as Record<string, unknown>,
    });
    return saved;
  }
}
