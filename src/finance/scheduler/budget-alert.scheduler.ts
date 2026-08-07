import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Budget } from '../entity/budget.entity';
import { JournalEntryLine } from '../entity/journal-entry-line.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { UtilityService } from '../../utility/service/utility.service';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { CacheService } from '../../utility/service/cache.service';
import { CHURCH_TIMEZONE } from '../../utility/constants/app.constants';
import { JournalEntryStatus } from '../enum/finance.enum';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { forEachActiveTenant } from '../../tenant/utility/for-each-active-tenant';

@Injectable()
export class BudgetAlertScheduler {
  private static readonly LOCK_KEY = 'lock:budget-utilization-alerts';
  private readonly logger = new Logger(BudgetAlertScheduler.name);

  constructor(
    @InjectRepository(Budget)
    private readonly budgetRepo: Repository<Budget>,
    @InjectRepository(JournalEntryLine)
    private readonly lineRepo: Repository<JournalEntryLine>,
    @InjectRepository(Admin)
    private readonly adminRepo: Repository<Admin>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly utilityService: UtilityService,
    private readonly cacheService: CacheService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM, { timeZone: CHURCH_TIMEZONE })
  async dispatchBudgetAlerts(): Promise<void> {
    const acquired = await this.cacheService.acquireLock(
      BudgetAlertScheduler.LOCK_KEY,
      300,
    );
    if (!acquired) return;

    try {
      await forEachActiveTenant(
        this.tenantRepo,
        this.cls,
        this.txHost,
        this.logger,
        () => this.runAlerts(),
      );
    } finally {
      this.cacheService.releaseLock(BudgetAlertScheduler.LOCK_KEY);
    }
  }

  private async runAlerts(): Promise<void> {
    const budgets = await this.budgetRepo.find({
      where: { isActive: true },
      relations: ['account'],
    });
    if (budgets.length === 0) return;

    const recipients = await this.fetchRecipients();
    if (recipients.length === 0) return;

    const actualsRows = await this.lineRepo
      .createQueryBuilder('l')
      .innerJoin('l.journalEntry', 'je')
      .innerJoin(
        'finance_budgets',
        'b',
        'b.account_id = l.account_id AND b.is_active = true AND je.date >= b.start_date AND je.date <= b.end_date',
      )
      .where('je.status = :status', { status: JournalEntryStatus.POSTED })
      .select('b.id', 'budgetId')
      .addSelect('l.entryType', 'entryType')
      .addSelect('SUM(l.amount)', 'total')
      .groupBy('b.id, l.entryType')
      .getRawMany<{ budgetId: string; entryType: string; total: string }>();

    const actualsMap = new Map<string, number>();
    for (const row of actualsRows) {
      const budget = budgets.find((b) => b.id === row.budgetId);
      if (!budget) continue;
      const isNormal =
        row.entryType === (budget.account.normalBalance as string);
      const current = actualsMap.get(row.budgetId) ?? 0;
      actualsMap.set(
        row.budgetId,
        current + (isNormal ? Number(row.total) : -Number(row.total)),
      );
    }

    for (const budget of budgets) {
      try {
        await this.processBudget(
          budget,
          actualsMap.get(budget.id) ?? 0,
          recipients,
        );
      } catch (err) {
        this.logger.error(
          `Failed to process budget alert for budget ${budget.id}`,
          err,
        );
      }
    }
  }

  private async processBudget(
    budget: Budget,
    actuals: number,
    recipients: string[],
  ): Promise<void> {
    const budgetAmount = Number(budget.amount);
    if (budgetAmount <= 0) return;

    const utilizationPct = (actuals / budgetAmount) * 100;
    let updated = false;

    if (utilizationPct >= 100 && !budget.alert100SentAt) {
      this.sendAlert(recipients, budget, actuals, 100);
      budget.alert100SentAt = new Date();
      updated = true;
    } else if (utilizationPct >= 80 && !budget.alert80SentAt) {
      this.sendAlert(recipients, budget, actuals, 80);
      budget.alert80SentAt = new Date();
      updated = true;
    }

    if (updated) {
      await this.budgetRepo.save(budget);
    }
  }

  private sendAlert(
    recipients: string[],
    budget: Budget,
    actuals: number,
    thresholdPct: number,
  ): void {
    const utilizationPct = Math.round((actuals / Number(budget.amount)) * 100);
    const isExhausted = thresholdPct >= 100;

    for (const email of recipients) {
      this.utilityService.sendEmailWithTemplate(
        email,
        isExhausted
          ? `Budget Exhausted: ${budget.name}`
          : `Budget Alert (${thresholdPct}% Used): ${budget.name}`,
        'finance-budget-alert',
        {
          budgetName: budget.name,
          budgetAmount: Number(budget.amount).toLocaleString(),
          actuals: actuals.toLocaleString(),
          utilizationPct,
          thresholdPct,
          startDate: budget.startDate,
          endDate: budget.endDate,
          isExhausted,
        },
        undefined,
        EmailCategory.FINANCE_ALERTS,
      );
    }
  }

  private async fetchRecipients(): Promise<string[]> {
    const admins = await this.adminRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.member', 'm')
      .leftJoinAndSelect('a.adminRole', 'role')
      .where('a.isActive = true')
      .getMany();

    return admins
      .filter((a) =>
        a.adminRole?.permissions?.includes(AdminPermission.FINANCE_READ),
      )
      .map((a) => a.member?.email)
      .filter((e): e is string => !!e);
  }
}
