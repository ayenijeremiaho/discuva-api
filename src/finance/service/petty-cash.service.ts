import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PettyCashReplenishment } from '../entity/petty-cash-replenishment.entity';
import { JournalEntry } from '../entity/journal-entry.entity';
import { JournalEntryLine } from '../entity/journal-entry-line.entity';
import { AccountingPeriod } from '../entity/accounting-period.entity';
import {
  ApprovePettyCashDto,
  CreatePettyCashReplenishmentDto,
} from '../dto/petty-cash.dto';
import {
  AccountingPeriodStatus,
  JournalEntrySource,
  JournalEntryStatus,
  JournalEntryType,
  JournalLineType,
  PettyCashReplenishmentStatus,
} from '../enum/finance.enum';
import { Admin } from '../../admin/entity/admin.entity';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';

@Injectable()
export class PettyCashService {
  constructor(
    @InjectRepository(PettyCashReplenishment)
    private readonly replenishmentRepo: Repository<PettyCashReplenishment>,
    @InjectRepository(JournalEntry)
    private readonly journalEntryRepo: Repository<JournalEntry>,
    @InjectRepository(JournalEntryLine)
    private readonly journalEntryLineRepo: Repository<JournalEntryLine>,
    @InjectRepository(AccountingPeriod)
    private readonly periodRepo: Repository<AccountingPeriod>,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(
    dto: CreatePettyCashReplenishmentDto,
    admin: Admin,
  ): Promise<PettyCashReplenishment> {
    const replenishment = this.replenishmentRepo.create({
      fromAccount: { id: dto.fromAccountId } as any,
      toCashAccount: { id: dto.toCashAccountId } as any,
      amount: dto.amount,
      notes: dto.notes ?? null,
      requestedBy: { id: admin.id } as any,
    });
    const saved = await this.replenishmentRepo.save(replenishment);
    this.auditLogService.log('PETTY_CASH_REQUESTED', {
      actorId: admin.id,
      targetId: saved.id,
      metadata: { amount: saved.amount },
    });
    return saved;
  }

  async findAll(
    page = 1,
    limit = 20,
  ): Promise<PaginationResponseDto<PettyCashReplenishment>> {
    const [data, totalCount] = await this.replenishmentRepo.findAndCount({
      relations: ['fromAccount', 'toCashAccount', 'requestedBy', 'requestedBy.member', 'approvedBy', 'approvedBy.member'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      data,
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async findOne(id: string): Promise<PettyCashReplenishment> {
    const r = await this.replenishmentRepo.findOne({
      where: { id },
      relations: ['fromAccount', 'toCashAccount', 'requestedBy', 'requestedBy.member', 'approvedBy', 'approvedBy.member'],
    });
    if (!r) throw new NotFoundException('Petty cash replenishment not found.');
    return r;
  }

  async reject(
    id: string,
    notes: string | undefined,
    admin: Admin,
  ): Promise<PettyCashReplenishment> {
    const r = await this.findOne(id);
    if (r.status !== PettyCashReplenishmentStatus.PENDING)
      throw new BadRequestException(
        'Only pending replenishments can be rejected.',
      );
    r.status = PettyCashReplenishmentStatus.REJECTED;
    if (notes) r.notes = notes;
    const saved = await this.replenishmentRepo.save(r);
    this.auditLogService.log('PETTY_CASH_REJECTED', {
      actorId: admin.id,
      targetId: saved.id,
    });
    return saved;
  }

  async approve(
    id: string,
    dto: ApprovePettyCashDto,
    admin: Admin,
  ): Promise<PettyCashReplenishment> {
    const r = await this.findOne(id);
    if (r.status !== PettyCashReplenishmentStatus.PENDING)
      throw new BadRequestException(
        'Only pending replenishments can be approved.',
      );
    if (r.requestedBy?.id === admin.id)
      throw new BadRequestException(
        'You cannot approve your own replenishment request.',
      );

    const idempotencyKey = `petty-cash-replenishment:${id}`;
    const [existing, period] = await Promise.all([
      this.journalEntryRepo.findOne({ where: { idempotencyKey } }),
      this.periodRepo.findOne({
        where: {
          year: new Date().getFullYear(),
          month: new Date().getMonth() + 1,
          status: AccountingPeriodStatus.OPEN,
        },
      }),
    ]);
    if (!existing && !period) {
      throw new BadRequestException(
        'No open accounting period for the current month — cannot create journal entry.',
      );
    }

    r.status = PettyCashReplenishmentStatus.APPROVED;
    r.approvedBy = { id: admin.id } as any;
    r.approvedAt = new Date();
    if (dto.notes) r.notes = dto.notes;
    const saved = await this.replenishmentRepo.save(r);

    if (!existing && period) {
      const entry = this.journalEntryRepo.create({
        date: new Date().toISOString().split('T')[0],
        description: `Petty cash replenishment${r.notes ? ': ' + r.notes : ''}`,
        source: JournalEntrySource.MANUAL,
        entryType: JournalEntryType.STANDARD,
        status: JournalEntryStatus.PENDING_APPROVAL,
        idempotencyKey,
        accountingPeriod: { id: period.id } as any,
        createdBy: { id: admin.id } as any,
      });
      const savedEntry = await this.journalEntryRepo.save(entry);

      await this.journalEntryLineRepo.save([
        this.journalEntryLineRepo.create({
          journalEntry: { id: savedEntry.id } as any,
          account: { id: r.toCashAccount.id } as any,
          entryType: JournalLineType.DEBIT,
          amount: r.amount,
        }),
        this.journalEntryLineRepo.create({
          journalEntry: { id: savedEntry.id } as any,
          account: { id: r.fromAccount.id } as any,
          entryType: JournalLineType.CREDIT,
          amount: r.amount,
        }),
      ]);
    }

    this.auditLogService.log('PETTY_CASH_APPROVED', {
      actorId: admin.id,
      targetId: saved.id,
    });
    return saved;
  }
}
