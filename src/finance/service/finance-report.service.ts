import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JournalEntry } from '../entity/journal-entry.entity';
import { JournalEntryLine } from '../entity/journal-entry-line.entity';
import { Account } from '../entity/account.entity';
import { Budget } from '../entity/budget.entity';
import { Pledge } from '../entity/pledge.entity';
import { PledgeCampaign } from '../entity/pledge-campaign.entity';
import { PettyCashReplenishment } from '../entity/petty-cash-replenishment.entity';
import { Fund } from '../entity/fund.entity';
import { AccountingPeriod } from '../entity/accounting-period.entity';
import {
  AccountSubtype,
  AccountType,
  JournalEntryStatus,
  JournalLineType,
  PettyCashReplenishmentStatus,
  PledgeStatus,
} from '../enum/finance.enum';

@Injectable()
export class FinanceReportService {
  constructor(
    @InjectRepository(JournalEntry)
    private readonly entryRepo: Repository<JournalEntry>,
    @InjectRepository(JournalEntryLine)
    private readonly lineRepo: Repository<JournalEntryLine>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    @InjectRepository(Budget)
    private readonly budgetRepo: Repository<Budget>,
    @InjectRepository(Pledge)
    private readonly pledgeRepo: Repository<Pledge>,
    @InjectRepository(PledgeCampaign)
    private readonly campaignRepo: Repository<PledgeCampaign>,
    @InjectRepository(Fund)
    private readonly fundRepo: Repository<Fund>,
    @InjectRepository(AccountingPeriod)
    private readonly periodRepo: Repository<AccountingPeriod>,
    @InjectRepository(PettyCashReplenishment)
    private readonly pettyCashRepo: Repository<PettyCashReplenishment>,
  ) {}

  async incomeExpense(periodId?: string, fundId?: string): Promise<object> {
    const qb = this.lineRepo
      .createQueryBuilder('l')
      .innerJoin('l.journalEntry', 'je')
      .innerJoin('l.account', 'a')
      .where('je.status = :status', { status: JournalEntryStatus.POSTED });

    if (periodId)
      qb.andWhere('je.accounting_period_id = :periodId', { periodId });
    if (fundId) qb.andWhere('a.fund_id = :fundId', { fundId });

    const lines = await qb
      .select([
        'a.type as account_type',
        'a.name as account_name',
        'l.entryType as entry_type',
        'SUM(l.amount) as total',
      ])
      .groupBy('a.type, a.name, l.entryType')
      .getRawMany();

    return { lines, generatedAt: new Date() };
  }

  async cashFlow(
    accountId: string,
    fromDate?: string,
    toDate?: string,
  ): Promise<object> {
    const account = await this.accountRepo.findOne({
      where: { id: accountId },
    });
    if (!account) throw new NotFoundException('Account not found.');

    // Omitting fromDate previously scanned every posted line ever recorded
    // against the account — default to a bounded 1-year lookback instead.
    const effectiveFromDate = fromDate ?? this.defaultReportFromDate();

    const qb = this.lineRepo
      .createQueryBuilder('l')
      .innerJoinAndSelect('l.journalEntry', 'je')
      .where('l.account_id = :accountId', { accountId })
      .andWhere('je.status = :status', { status: JournalEntryStatus.POSTED })
      .andWhere('je.date >= :fromDate', { fromDate: effectiveFromDate })
      .orderBy('je.date', 'ASC');

    if (toDate) qb.andWhere('je.date <= :toDate', { toDate });

    const lines = await qb.getMany();
    return {
      account: {
        id: account.id,
        name: account.name,
        currentBalance: account.currentBalance,
      },
      fromDate: effectiveFromDate,
      toDate: toDate ?? null,
      lines,
      generatedAt: new Date(),
    };
  }

  private defaultReportFromDate(): string {
    const d = new Date();
    d.setDate(d.getDate() - 365);
    return d.toISOString().slice(0, 10);
  }

  async trialBalance(periodId?: string): Promise<object> {
    if (!periodId) {
      const accounts = await this.accountRepo.find({
        relations: ['fund'],
        order: { type: 'ASC', name: 'ASC' },
      });
      return { accounts, periodId: null, generatedAt: new Date() };
    }

    const rows = await this.lineRepo
      .createQueryBuilder('l')
      .innerJoin('l.journalEntry', 'je')
      .innerJoin('l.account', 'a')
      .innerJoin('a.fund', 'f')
      .where('je.accounting_period_id = :periodId', { periodId })
      .andWhere('je.status = :status', { status: JournalEntryStatus.POSTED })
      .select('a.id', 'accountId')
      .addSelect('a.name', 'accountName')
      .addSelect('a.type', 'accountType')
      .addSelect('a.normal_balance', 'normalBalance')
      .addSelect('f.id', 'fundId')
      .addSelect('f.name', 'fundName')
      .addSelect('l.entryType', 'entryType')
      .addSelect('SUM(l.amount)', 'total')
      .groupBy(
        'a.id, a.name, a.type, a.normal_balance, f.id, f.name, l.entryType',
      )
      .getRawMany<{
        accountId: string;
        accountName: string;
        accountType: string;
        normalBalance: string;
        fundId: string;
        fundName: string;
        entryType: string;
        total: string;
      }>();

    const accountMap = new Map<
      string,
      {
        id: string;
        name: string;
        type: string;
        normalBalance: string;
        fund: { id: string; name: string };
        balance: number;
      }
    >();
    for (const row of rows) {
      const existing = accountMap.get(row.accountId) ?? {
        id: row.accountId,
        name: row.accountName,
        type: row.accountType,
        normalBalance: row.normalBalance,
        fund: { id: row.fundId, name: row.fundName },
        balance: 0,
      };
      const isNormal = row.entryType === row.normalBalance;
      existing.balance += isNormal ? Number(row.total) : -Number(row.total);
      accountMap.set(row.accountId, existing);
    }

    return {
      accounts: Array.from(accountMap.values()),
      periodId,
      generatedAt: new Date(),
    };
  }

  async fundBalance(): Promise<object> {
    const rows = await this.accountRepo
      .createQueryBuilder('a')
      .innerJoin('a.fund', 'f')
      .select('f.id', 'fundId')
      .addSelect('f.name', 'fundName')
      .addSelect('f.type', 'fundType')
      .addSelect('SUM(a.current_balance)', 'totalBalance')
      .addSelect('COUNT(a.id)', 'accountCount')
      .groupBy('f.id, f.name, f.type')
      .orderBy('f.name', 'ASC')
      .getRawMany<{
        fundId: string;
        fundName: string;
        fundType: string;
        totalBalance: string;
        accountCount: string;
      }>();

    return {
      funds: rows.map((r) => ({
        fund: { id: r.fundId, name: r.fundName, type: r.fundType },
        totalBalance: Number(r.totalBalance ?? 0),
        accountCount: Number(r.accountCount),
      })),
      generatedAt: new Date(),
    };
  }

  async accountLedger(
    accountId: string,
    fromDate?: string,
    toDate?: string,
  ): Promise<object> {
    const account = await this.accountRepo.findOne({
      where: { id: accountId },
      relations: ['fund'],
    });
    if (!account) throw new NotFoundException('Account not found.');

    // Omitting fromDate previously scanned every posted line ever recorded
    // against the account — default to a bounded 1-year lookback instead.
    const effectiveFromDate = fromDate ?? this.defaultReportFromDate();

    const qb = this.lineRepo
      .createQueryBuilder('l')
      .innerJoinAndSelect('l.journalEntry', 'je')
      .where('l.account_id = :accountId', { accountId })
      .andWhere('je.status = :status', { status: JournalEntryStatus.POSTED })
      .andWhere('je.date >= :fromDate', { fromDate: effectiveFromDate })
      .orderBy('je.date', 'ASC')
      .addOrderBy('je.createdAt', 'ASC');

    if (toDate) qb.andWhere('je.date <= :toDate', { toDate });

    const lines = await qb.getMany();
    return {
      account,
      fromDate: effectiveFromDate,
      toDate: toDate ?? null,
      lines,
      generatedAt: new Date(),
    };
  }

  async budgetActuals(budgetId: string): Promise<object> {
    const budget = await this.budgetRepo.findOne({
      where: { id: budgetId },
      relations: ['fund', 'account', 'createdBy'],
    });
    if (!budget) throw new NotFoundException('Budget not found.');

    const posted = await this.lineRepo
      .createQueryBuilder('l')
      .innerJoin('l.journalEntry', 'je')
      .where('l.account_id = :accountId', { accountId: budget.account.id })
      .andWhere('je.status = :status', { status: JournalEntryStatus.POSTED })
      .andWhere('je.date >= :startDate', { startDate: budget.startDate })
      .andWhere('je.date <= :endDate', { endDate: budget.endDate })
      .select('SUM(l.amount)', 'total')
      .addSelect('l.entryType', 'entry_type')
      .groupBy('l.entryType')
      .getRawMany();

    const actuals = posted.reduce((s, r) => {
      const isNormalSide = r.entry_type === budget.account.normalBalance;
      return s + (isNormalSide ? Number(r.total) : -Number(r.total));
    }, 0);

    return {
      budget,
      actuals,
      variance: Number(budget.amount) - actuals,
      generatedAt: new Date(),
    };
  }

  async pledgeSummary(campaignId: string): Promise<object> {
    const campaign = await this.campaignRepo.findOne({
      where: { id: campaignId },
      relations: ['fund', 'createdBy'],
    });
    if (!campaign) throw new NotFoundException('Campaign not found.');

    const pledges = await this.pledgeRepo.find({
      where: { campaign: { id: campaignId } },
      relations: ['member'],
    });
    const totalPledged = pledges.reduce((s, p) => s + Number(p.totalAmount), 0);

    return {
      campaign,
      pledges,
      totalPledged,
      pledgeCount: pledges.length,
      generatedAt: new Date(),
    };
  }

  async dashboard(): Promise<object> {
    const now = new Date();
    const mtdStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const mtdEnd = now.toISOString().slice(0, 10);

    const [
      mtdRows,
      pendingJournalEntries,
      pendingPettyCash,
      activeBudgets,
      outstandingPledges,
    ] = await Promise.all([
      this.lineRepo
        .createQueryBuilder('l')
        .innerJoin('l.journalEntry', 'je')
        .innerJoin('l.account', 'a')
        .where('je.status = :status', { status: JournalEntryStatus.POSTED })
        .andWhere('je.date >= :mtdStart', { mtdStart })
        .andWhere('je.date <= :mtdEnd', { mtdEnd })
        .andWhere('a.type IN (:...types)', {
          types: [AccountType.INCOME, AccountType.EXPENSE],
        })
        .select([
          'a.type AS account_type',
          'l.entryType AS entry_type',
          'SUM(l.amount) AS total',
        ])
        .groupBy('a.type, l.entryType')
        .getRawMany(),

      this.entryRepo.count({
        where: { status: JournalEntryStatus.PENDING_APPROVAL },
      }),

      this.pettyCashRepo.count({
        where: { status: PettyCashReplenishmentStatus.PENDING },
      }),

      this.budgetRepo.find({
        where: { isActive: true },
        relations: ['account'],
      }),

      this.pledgeRepo
        .createQueryBuilder('p')
        .where('p.status = :status', { status: PledgeStatus.ACTIVE })
        .select('SUM(p.totalAmount)', 'total')
        .addSelect('COUNT(p.id)', 'count')
        .getRawOne(),
    ]);

    const mtdIncome = mtdRows
      .filter(
        (r) =>
          r.account_type === AccountType.INCOME &&
          r.entry_type === JournalLineType.CREDIT,
      )
      .reduce((s, r) => s + Number(r.total), 0);

    const mtdExpenses = mtdRows
      .filter(
        (r) =>
          r.account_type === AccountType.EXPENSE &&
          r.entry_type === JournalLineType.DEBIT,
      )
      .reduce((s, r) => s + Number(r.total), 0);

    const actualsRows: {
      budgetId: string;
      entryType: string;
      total: string;
    }[] =
      activeBudgets.length === 0
        ? []
        : await this.lineRepo
            .createQueryBuilder('l')
            .innerJoin('l.journalEntry', 'je')
            .innerJoin(
              'finance_budgets',
              'b',
              'b.account_id = l.account_id AND b.is_active = true AND je.date >= b.start_date AND je.date <= b.end_date',
            )
            .where('je.status = :status', { status: JournalEntryStatus.POSTED })
            .andWhere('b.id IN (:...budgetIds)', {
              budgetIds: activeBudgets.map((b) => b.id),
            })
            .select('b.id', 'budgetId')
            .addSelect('l.entryType', 'entryType')
            .addSelect('SUM(l.amount)', 'total')
            .groupBy('b.id, l.entryType')
            .getRawMany<{
              budgetId: string;
              entryType: string;
              total: string;
            }>();

    const actualsMap = new Map<string, { debit: number; credit: number }>();
    for (const row of actualsRows) {
      const existing = actualsMap.get(row.budgetId) ?? { debit: 0, credit: 0 };
      if (row.entryType === JournalLineType.DEBIT)
        existing.debit += Number(row.total);
      else existing.credit += Number(row.total);
      actualsMap.set(row.budgetId, existing);
    }

    const budgetUtilizations = activeBudgets.map((budget) => {
      const data = actualsMap.get(budget.id) ?? { debit: 0, credit: 0 };
      const isDebitNormal =
        (budget.account.normalBalance as string) === JournalLineType.DEBIT;
      const actuals = isDebitNormal
        ? data.debit - data.credit
        : data.credit - data.debit;
      const utilizationPct =
        Number(budget.amount) > 0
          ? Math.round((actuals / Number(budget.amount)) * 100)
          : 0;
      return {
        budgetId: budget.id,
        name: budget.name,
        amount: Number(budget.amount),
        actuals,
        utilizationPct,
      };
    });

    return {
      mtdIncome,
      mtdExpenses,
      mtdNet: mtdIncome - mtdExpenses,
      pendingJournalEntries,
      pendingPettyCash,
      budgetsNearLimit: budgetUtilizations
        .filter((b) => b.utilizationPct >= 80)
        .sort((a, b) => b.utilizationPct - a.utilizationPct),
      totalOutstandingPledges: Number(outstandingPledges?.total ?? 0),
      activePledgeCount: Number(outstandingPledges?.count ?? 0),
      generatedAt: new Date(),
    };
  }

  async memberGiving(
    memberId: string,
    periodId?: string,
    fromDate?: string,
    toDate?: string,
    accountSubtype?: AccountSubtype,
  ): Promise<object> {
    // A periodId already scopes the query to that accounting period, so an
    // unbounded default lookback would only ever narrow results that are
    // already bounded — the default applies only when neither is given.
    const effectiveFromDate =
      fromDate ?? (periodId ? undefined : this.defaultReportFromDate());

    const qb = this.lineRepo
      .createQueryBuilder('l')
      .innerJoin('l.journalEntry', 'je')
      .innerJoin(
        'finance_journal_entry_links',
        'lk',
        'lk.journal_entry_id = je.id AND lk.member_id = :memberId',
        { memberId },
      )
      .leftJoinAndSelect('l.account', 'a')
      .where('je.status = :status', { status: JournalEntryStatus.POSTED })
      .orderBy('je.date', 'ASC');

    if (periodId)
      qb.andWhere('je.accounting_period_id = :periodId', { periodId });
    if (effectiveFromDate)
      qb.andWhere('je.date >= :fromDate', { fromDate: effectiveFromDate });
    if (toDate) qb.andWhere('je.date <= :toDate', { toDate });
    if (accountSubtype)
      qb.andWhere('a.subtype = :accountSubtype', { accountSubtype });

    const lines = await qb.getMany();
    const total = lines.reduce((s, l) => s + Number(l.amount), 0);

    return {
      memberId,
      periodId: periodId ?? null,
      fromDate: effectiveFromDate ?? null,
      toDate: toDate ?? null,
      accountSubtype: accountSubtype ?? null,
      lines,
      total,
      generatedAt: new Date(),
    };
  }
}
