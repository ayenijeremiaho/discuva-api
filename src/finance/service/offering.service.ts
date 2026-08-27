import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Offering } from '../entity/offering.entity';
import { JournalEntry } from '../entity/journal-entry.entity';
import { JournalEntryLine } from '../entity/journal-entry-line.entity';
import { Account } from '../entity/account.entity';
import { AccountingPeriod } from '../entity/accounting-period.entity';
import {
  CreateOfferingDto,
  OfferingQueryDto,
  ReconcileOfferingDto,
} from '../dto/offering.dto';
import { Admin } from '../../admin/entity/admin.entity';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';
import {
  AccountingPeriodStatus,
  JournalEntrySource,
  JournalEntryStatus,
  JournalEntryType,
  JournalLineType,
} from '../enum/finance.enum';

@Injectable()
export class OfferingService {
  constructor(
    @InjectRepository(Offering)
    private readonly offeringRepo: Repository<Offering>,
    @InjectRepository(JournalEntry)
    private readonly journalEntryRepo: Repository<JournalEntry>,
    @InjectRepository(JournalEntryLine)
    private readonly journalEntryLineRepo: Repository<JournalEntryLine>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    @InjectRepository(AccountingPeriod)
    private readonly periodRepo: Repository<AccountingPeriod>,
    private readonly auditLogService: AuditLogService,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  async create(dto: CreateOfferingDto, admin: Admin): Promise<Offering> {
    const offering = this.offeringRepo.create({
      serviceEventId: dto.serviceEventId ?? null,
      fund: { id: dto.fundId } as any,
      type: dto.type,
      cashAmount: dto.cashAmount ?? 0,
      expectedTransferAmount: dto.expectedTransferAmount ?? 0,
      notes: dto.notes ?? null,
      recordedBy: { id: admin.id } as any,
    });
    const saved = await this.offeringRepo.save(offering);
    this.auditLogService.log('OFFERING_RECORDED', {
      actorId: admin.id,
      targetId: saved.id,
      metadata: { type: saved.type, fundId: dto.fundId },
    });
    return saved;
  }

  async findAll(
    query: OfferingQueryDto,
  ): Promise<PaginationResponseDto<Offering>> {
    const { page = 1, limit = 20, fundId, type, fromDate, toDate } = query;
    const qb = this.offeringRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.fund', 'fund')
      .leftJoinAndSelect('o.recordedBy', 'recordedBy')
      .leftJoinAndSelect('recordedBy.member', 'recordedByMember')
      .leftJoinAndSelect('o.reconciledBy', 'reconciledBy')
      .leftJoinAndSelect('reconciledBy.member', 'reconciledByMember')
      .orderBy('o.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (fundId) qb.andWhere('fund.id = :fundId', { fundId });
    if (type) qb.andWhere('o.type = :type', { type });
    if (fromDate) qb.andWhere('o.createdAt >= :fromDate', { fromDate });
    if (toDate) qb.andWhere('o.createdAt <= :toDate', { toDate });

    const [data, totalCount] = await qb.getManyAndCount();
    return {
      data,
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async findOne(id: string): Promise<Offering> {
    const offering = await this.offeringRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.fund', 'fund')
      .leftJoinAndSelect('o.recordedBy', 'recordedBy')
      .leftJoinAndSelect('recordedBy.member', 'recordedByMember')
      .leftJoinAndSelect('o.reconciledBy', 'reconciledBy')
      .leftJoinAndSelect('reconciledBy.member', 'reconciledByMember')
      .where('o.id = :id', { id })
      .getOne();
    if (!offering) throw new NotFoundException('Offering not found.');
    return offering;
  }

  async reconcile(
    id: string,
    dto: ReconcileOfferingDto,
    admin: Admin,
  ): Promise<Offering> {
    const offering = await this.findOne(id);
    if (offering.isReconciled)
      throw new BadRequestException('Offering is already reconciled.');
    if (offering.recordedBy?.id === admin.id)
      throw new BadRequestException(
        'You cannot reconcile a giving entry you recorded. Another administrator must review it.',
      );

    offering.isReconciled = true;
    offering.reconciledAt = new Date();
    offering.reconciledBy = { id: admin.id } as any;
    offering.notes = dto.notes;
    const saved = await this.offeringRepo.save(offering);

    this.auditLogService.log('OFFERING_RECONCILED', {
      actorId: admin.id,
      targetId: saved.id,
    });

    if (dto.autoJournal) {
      await this.createAutoJournal(saved, dto, admin);
    }

    return this.findOne(saved.id);
  }

  private async createAutoJournal(
    offering: Offering,
    dto: ReconcileOfferingDto,
    admin: Admin,
  ): Promise<void> {
    const [debitAccount, creditAccount, period] = await Promise.all([
      this.accountRepo.findOne({ where: { id: dto.debitAccountId } }),
      this.accountRepo.findOne({ where: { id: dto.creditAccountId } }),
      this.periodRepo.findOne({ where: { id: dto.accountingPeriodId } }),
    ]);

    if (!debitAccount)
      throw new BadRequestException('Debit account not found.');
    if (!creditAccount)
      throw new BadRequestException('Credit account not found.');
    if (!period) throw new BadRequestException('Accounting period not found.');
    if (period.status === AccountingPeriodStatus.CLOSED)
      throw new BadRequestException('Accounting period is closed.');

    const total =
      Number(offering.cashAmount) + Number(offering.expectedTransferAmount);
    if (total <= 0)
      throw new BadRequestException(
        'Offering total is zero — cannot auto-create journal entry.',
      );

    // Deliberately this.txHost.tx, not this.dataSource.transaction() — see
    // JournalEntryService for the full rationale (would open a connection
    // that never sees TenantMiddleware's SET LOCAL search_path).
    const manager = this.txHost.tx;
    const idempotencyKey = `offering-auto-journal:${offering.id}`;
    const existing = await manager.findOne(JournalEntry, {
      where: { idempotencyKey },
    });
    if (existing) return;

    const entry = manager.create(JournalEntry, {
      date: new Date().toISOString().slice(0, 10),
      description: `Offering reconciliation — ${offering.type} (${offering.createdAt.toISOString().slice(0, 10)})`,
      source: JournalEntrySource.MANUAL,
      entryType: JournalEntryType.STANDARD,
      status: JournalEntryStatus.PENDING_APPROVAL,
      idempotencyKey,
      accountingPeriod: { id: period.id } as any,
      createdBy: { id: admin.id } as any,
    });
    const savedEntry = await manager.save(JournalEntry, entry);

    await manager.save(JournalEntryLine, [
      manager.create(JournalEntryLine, {
        journalEntry: { id: savedEntry.id } as any,
        account: { id: debitAccount.id } as any,
        entryType: JournalLineType.DEBIT,
        amount: total,
      }),
      manager.create(JournalEntryLine, {
        journalEntry: { id: savedEntry.id } as any,
        account: { id: creditAccount.id } as any,
        entryType: JournalLineType.CREDIT,
        amount: total,
      }),
    ]);

    this.auditLogService.log('JOURNAL_ENTRY_CREATED', {
      actorId: admin.id,
      targetId: savedEntry.id,
      metadata: { source: 'offering-auto-journal', offeringId: offering.id },
    });
  }
}
