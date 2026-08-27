import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { JournalEntry } from '../entity/journal-entry.entity';
import { JournalEntryLine } from '../entity/journal-entry-line.entity';
import { JournalEntryLink } from '../entity/journal-entry-link.entity';
import { Account } from '../entity/account.entity';
import { AccountingPeriod } from '../entity/accounting-period.entity';
import { CreateJournalEntryDto } from '../dto/journal-entry.dto';
import {
  AccountingPeriodStatus,
  JournalEntryStatus,
  JournalEntryType,
  JournalLineType,
} from '../enum/finance.enum';
import { Admin } from '../../admin/entity/admin.entity';
import { AuditLogService } from '../../utility/service/audit-log.service';
import { PaginationResponseDto } from '../../utility/dto/pagination-response.dto';

interface JournalEntryQuery {
  page?: number;
  limit?: number;
  accountingPeriodId?: string;
  source?: string;
  entryType?: string;
  fromDate?: string;
  toDate?: string;
}

@Injectable()
export class JournalEntryService {
  private readonly logger = new Logger(JournalEntryService.name);

  constructor(
    @InjectRepository(JournalEntry)
    private readonly entryRepo: Repository<JournalEntry>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    @InjectRepository(AccountingPeriod)
    private readonly periodRepo: Repository<AccountingPeriod>,
    // Deliberately NOT DataSource — see approve()/void()/create() below.
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(
    dto: CreateJournalEntryDto,
    admin: Admin,
  ): Promise<JournalEntry> {
    const debits = dto.lines
      .filter((l) => l.entryType === JournalLineType.DEBIT)
      .reduce((s, l) => s + Number(l.amount), 0);
    const credits = dto.lines
      .filter((l) => l.entryType === JournalLineType.CREDIT)
      .reduce((s, l) => s + Number(l.amount), 0);
    if (Math.abs(debits - credits) > 0.01) {
      throw new BadRequestException(
        `Journal entry is unbalanced: debits ${debits}, credits ${credits}.`,
      );
    }

    const manager = this.txHost.tx;
    try {
      const period = await manager.findOne(AccountingPeriod, {
        where: { id: dto.accountingPeriodId },
      });
      if (!period) throw new NotFoundException('Accounting period not found.');
      if (period.status === AccountingPeriodStatus.CLOSED)
        throw new BadRequestException(
          'Cannot post to a closed accounting period.',
        );

      const accountIds = [...new Set(dto.lines.map((l) => l.accountId))];
      const accounts = await manager
        .createQueryBuilder(Account, 'a')
        .where('a.id IN (:...ids)', { ids: accountIds })
        .setLock('pessimistic_write')
        .getMany();

      if (accounts.length !== accountIds.length)
        throw new NotFoundException('One or more accounts not found.');

      const entry = manager.create(JournalEntry, {
        date: dto.date,
        description: dto.description,
        reference: dto.reference ?? null,
        source: dto.source,
        entryType: dto.entryType,
        status: JournalEntryStatus.PENDING_APPROVAL,
        idempotencyKey: dto.idempotencyKey,
        accountingPeriod: { id: dto.accountingPeriodId } as any,
        createdBy: { id: admin.id } as any,
        originalCurrency: dto.originalCurrency ?? null,
        exchangeRate: dto.exchangeRate ?? null,
        originalAmount: dto.originalAmount ?? null,
      });

      const savedEntry = await manager.save(JournalEntry, entry);

      const lines = dto.lines.map((l) =>
        manager.create(JournalEntryLine, {
          journalEntry: { id: savedEntry.id } as any,
          account: { id: l.accountId } as any,
          entryType: l.entryType,
          amount: l.amount,
        }),
      );
      await manager.save(JournalEntryLine, lines);

      if (dto.links?.length) {
        const links = dto.links.map((lk) =>
          manager.create(JournalEntryLink, {
            journalEntry: { id: savedEntry.id } as any,
            linkType: lk.linkType,
            role: lk.role,
            member: lk.memberId ? ({ id: lk.memberId } as any) : null,
            department: lk.departmentId
              ? ({ id: lk.departmentId } as any)
              : null,
            serviceEventId: lk.serviceEventId ?? null,
            externalPayee: lk.externalPayeeId
              ? ({ id: lk.externalPayeeId } as any)
              : null,
          }),
        );
        await manager.save(JournalEntryLink, links);
      }

      this.auditLogService.log('JOURNAL_ENTRY_CREATED', {
        actorId: admin.id,
        targetId: savedEntry.id,
        metadata: { idempotencyKey: dto.idempotencyKey },
      });
      return savedEntry;
    } catch (err: any) {
      if (err?.code === '23505' && err?.constraint?.includes('idempotency')) {
        throw new ConflictException(
          'A journal entry with this idempotency key already exists.',
        );
      }
      throw err;
    }
  }

  async approve(id: string, admin: Admin): Promise<JournalEntry> {
    const manager = this.txHost.tx;
    const locked = await manager
      .createQueryBuilder(JournalEntry, 'je')
      .where('je.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
    if (!locked) throw new NotFoundException('Journal entry not found.');

    const entry = await manager.findOne(JournalEntry, {
      where: { id },
      relations: ['lines', 'lines.account', 'accountingPeriod', 'createdBy'],
    });
    if (!entry) throw new NotFoundException('Journal entry not found.');
    if (entry.status !== JournalEntryStatus.PENDING_APPROVAL)
      throw new BadRequestException('Only pending entries can be approved.');
    if (entry.createdBy?.id === admin.id)
      throw new ForbiddenException('You cannot approve an entry you created.');

    const period = await manager.findOne(AccountingPeriod, {
      where: { id: entry.accountingPeriod?.id },
    });
    if (period?.status === AccountingPeriodStatus.CLOSED)
      throw new BadRequestException(
        'Cannot post to a closed accounting period.',
      );

    const accountIds = [...new Set(entry.lines.map((l) => l.account.id))];
    const accounts = await manager
      .createQueryBuilder(Account, 'a')
      .where('a.id IN (:...ids)', { ids: accountIds })
      .setLock('pessimistic_write')
      .getMany();
    const accountMap = new Map(accounts.map((a) => [a.id, a]));

    for (const line of entry.lines) {
      const account = accountMap.get(line.account.id);
      if (!account)
        throw new NotFoundException(`Account ${line.account.id} not found.`);
      const isNormalSide =
        (account.normalBalance as string) === (line.entryType as string);
      if (isNormalSide) {
        account.currentBalance =
          Number(account.currentBalance) + Number(line.amount);
      } else {
        account.currentBalance =
          Number(account.currentBalance) - Number(line.amount);
      }
    }

    await manager.save(Account, accounts);

    entry.status = JournalEntryStatus.POSTED;
    entry.approvedBy = { id: admin.id } as any;
    const saved = await manager.save(JournalEntry, entry);
    this.auditLogService.log('JOURNAL_ENTRY_APPROVED', {
      actorId: admin.id,
      targetId: saved.id,
    });
    return saved;
  }

  async void(id: string, admin: Admin): Promise<JournalEntry> {
    const manager = this.txHost.tx;
    const locked = await manager
      .createQueryBuilder(JournalEntry, 'je')
      .where('je.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
    if (!locked) throw new NotFoundException('Journal entry not found.');

    const entry = await manager.findOne(JournalEntry, {
      where: { id },
      relations: ['lines', 'lines.account', 'accountingPeriod'],
    });
    if (!entry) throw new NotFoundException('Journal entry not found.');
    if (entry.status === JournalEntryStatus.VOIDED)
      throw new ConflictException('Entry is already voided.');
    if (entry.status !== JournalEntryStatus.POSTED)
      throw new BadRequestException('Only posted entries can be voided.');
    if (entry.accountingPeriod?.status === AccountingPeriodStatus.CLOSED)
      throw new BadRequestException(
        'Cannot void an entry in a closed accounting period.',
      );

    const reversalIdempotencyKey = `reversal-${entry.idempotencyKey}`;
    const existingReversal = await manager.findOne(JournalEntry, {
      where: { idempotencyKey: reversalIdempotencyKey },
    });
    if (existingReversal)
      throw new ConflictException('A reversal for this entry already exists.');

    const accountIds = [...new Set(entry.lines.map((l) => l.account.id))];
    const accounts = await manager
      .createQueryBuilder(Account, 'a')
      .where('a.id IN (:...ids)', { ids: accountIds })
      .setLock('pessimistic_write')
      .getMany();
    const accountMap = new Map(accounts.map((a) => [a.id, a]));

    for (const line of entry.lines) {
      const account = accountMap.get(line.account.id);
      if (!account) continue;
      const wasNormalSide =
        (account.normalBalance as string) === (line.entryType as string);
      if (wasNormalSide) {
        account.currentBalance =
          Number(account.currentBalance) - Number(line.amount);
      } else {
        account.currentBalance =
          Number(account.currentBalance) + Number(line.amount);
      }
    }
    await manager.save(Account, accounts);

    const reversal = manager.create(JournalEntry, {
      date: new Date().toISOString().split('T')[0],
      description: `Reversal of: ${entry.description}`,
      source: entry.source,
      entryType: JournalEntryType.REVERSAL,
      status: JournalEntryStatus.POSTED,
      idempotencyKey: reversalIdempotencyKey,
      accountingPeriod: entry.accountingPeriod,
      reversalOf: { id: entry.id } as any,
      createdBy: { id: admin.id } as any,
      approvedBy: { id: admin.id } as any,
    });
    const savedReversal = await manager.save(JournalEntry, reversal);

    const reversalLines = entry.lines.map((l) =>
      manager.create(JournalEntryLine, {
        journalEntry: { id: savedReversal.id } as any,
        account: { id: l.account.id } as any,
        entryType:
          l.entryType === JournalLineType.DEBIT
            ? JournalLineType.CREDIT
            : JournalLineType.DEBIT,
        amount: l.amount,
      }),
    );
    await manager.save(JournalEntryLine, reversalLines);

    entry.status = JournalEntryStatus.VOIDED;
    await manager.save(JournalEntry, entry);

    this.auditLogService.log('JOURNAL_ENTRY_VOIDED', {
      actorId: admin.id,
      targetId: entry.id,
      metadata: { reversalId: savedReversal.id },
    });
    return savedReversal;
  }

  async reject(id: string): Promise<JournalEntry> {
    const entry = await this.entryRepo.findOne({ where: { id } });
    if (!entry) throw new NotFoundException('Journal entry not found.');
    if (entry.status !== JournalEntryStatus.PENDING_APPROVAL)
      throw new BadRequestException('Only pending entries can be declined.');
    entry.status = JournalEntryStatus.DRAFT;
    return this.entryRepo.save(entry);
  }

  async resubmit(id: string): Promise<JournalEntry> {
    const entry = await this.entryRepo.findOne({ where: { id } });
    if (!entry) throw new NotFoundException('Journal entry not found.');
    if (entry.status !== JournalEntryStatus.DRAFT)
      throw new BadRequestException('Only draft entries can be resubmitted.');
    entry.status = JournalEntryStatus.PENDING_APPROVAL;
    return this.entryRepo.save(entry);
  }

  async deleteDraft(id: string): Promise<void> {
    const entry = await this.entryRepo.findOne({ where: { id } });
    if (!entry) throw new NotFoundException('Journal entry not found.');
    if (entry.status !== JournalEntryStatus.DRAFT)
      throw new BadRequestException('Only draft entries can be deleted.');
    await this.entryRepo.remove(entry);
  }

  async findAll(
    query: JournalEntryQuery,
  ): Promise<PaginationResponseDto<JournalEntry>> {
    const {
      page = 1,
      limit = 20,
      accountingPeriodId,
      source,
      entryType,
      fromDate,
      toDate,
    } = query;
    const qb = this.entryRepo
      .createQueryBuilder('je')
      .leftJoinAndSelect('je.lines', 'lines')
      .leftJoinAndSelect('je.createdBy', 'createdBy')
      .leftJoinAndSelect('createdBy.member', 'createdByMember')
      .leftJoinAndSelect('je.approvedBy', 'approvedBy')
      .leftJoinAndSelect('approvedBy.member', 'approvedByMember')
      .leftJoinAndSelect('je.accountingPeriod', 'period')
      .orderBy('je.date', 'DESC')
      .addOrderBy('je.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (accountingPeriodId)
      qb.andWhere('period.id = :accountingPeriodId', { accountingPeriodId });
    if (source) qb.andWhere('je.source = :source', { source });
    if (entryType) qb.andWhere('je.entryType = :entryType', { entryType });
    if (fromDate) qb.andWhere('je.date >= :fromDate', { fromDate });
    if (toDate) qb.andWhere('je.date <= :toDate', { toDate });

    const [data, totalCount] = await qb.getManyAndCount();
    return {
      data,
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async findOne(id: string): Promise<JournalEntry> {
    const entry = await this.entryRepo.findOne({
      where: { id },
      relations: [
        'lines',
        'lines.account',
        'links',
        'links.member',
        'links.department',
        'links.externalPayee',
        'accountingPeriod',
        'createdBy',
        'createdBy.member',
        'approvedBy',
        'approvedBy.member',
      ],
    });
    if (!entry) throw new NotFoundException('Journal entry not found.');
    return entry;
  }
}
