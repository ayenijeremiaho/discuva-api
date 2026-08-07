import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { RecurringEntry } from '../entity/recurring-entry.entity';
import { JournalEntry } from '../entity/journal-entry.entity';
import { JournalEntryLine } from '../entity/journal-entry-line.entity';
import { AccountingPeriod } from '../entity/accounting-period.entity';
import { CacheService } from '../../utility/service/cache.service';
import { CHURCH_TIMEZONE } from '../../utility/constants/app.constants';
import {
  AccountingPeriodStatus,
  JournalEntrySource,
  JournalEntryStatus,
  JournalEntryType,
  JournalLineType,
  RecurringFrequency,
} from '../enum/finance.enum';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { forEachActiveTenant } from '../../tenant/utility/for-each-active-tenant';

@Injectable()
export class RecurringEntryScheduler {
  private static readonly LOCK_KEY = 'lock:finance-recurring-entries';
  private readonly logger = new Logger(RecurringEntryScheduler.name);

  constructor(
    @InjectRepository(RecurringEntry)
    private readonly recurringRepo: Repository<RecurringEntry>,
    @InjectRepository(AccountingPeriod)
    private readonly periodRepo: Repository<AccountingPeriod>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly cacheService: CacheService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM, { timeZone: CHURCH_TIMEZONE })
  async generateDueEntries(): Promise<void> {
    const acquired = await this.cacheService.acquireLock(
      RecurringEntryScheduler.LOCK_KEY,
      300,
    );
    if (!acquired) return;

    try {
      await forEachActiveTenant(
        this.tenantRepo,
        this.cls,
        this.txHost,
        this.logger,
        () => this.run(),
      );
    } finally {
      this.cacheService.releaseLock(RecurringEntryScheduler.LOCK_KEY);
    }
  }

  private async run(): Promise<void> {
    const now = new Date();
    const dueEntries = await this.recurringRepo.find({
      where: { isActive: true, nextDueAt: LessThanOrEqual<Date>(now) },
      relations: ['debitAccount', 'creditAccount', 'fund', 'createdBy'],
    });

    if (dueEntries.length === 0) return;

    const period = await this.periodRepo.findOne({
      where: {
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        status: AccountingPeriodStatus.OPEN,
      },
    });

    if (!period) {
      this.logger.warn(
        'No open accounting period for current month — skipping recurring entry generation',
      );
      return;
    }

    // Uses the ambient this.txHost.tx manager (already inside the outer
    // per-tenant transaction forEachActiveTenant opened, with the correct
    // search_path set) rather than this.dataSource.transaction(...), which
    // would start an independent transaction — likely a different pooled
    // connection — that never sees the outer SET LOCAL search_path and
    // would silently write to the wrong schema. Each entry still gets its
    // own SAVEPOINT so one failing entry rolls back in isolation instead of
    // aborting the whole tenant's batch.
    const manager = this.txHost.tx;
    let generated = 0;
    for (const recurring of dueEntries) {
      const savepoint = `recurring_entry_${generated + 1}`;
      try {
        const idempotencyKey = `recurring-${recurring.id}-${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
        await manager.query(`SAVEPOINT "${savepoint}"`);

        const existing = await manager.findOne(JournalEntry, {
          where: { idempotencyKey },
        });
        if (existing) {
          await manager.query(`RELEASE SAVEPOINT "${savepoint}"`);
          continue;
        }

        const entry = manager.create(JournalEntry, {
          date: now.toISOString().split('T')[0],
          description: recurring.description,
          source: JournalEntrySource.MANUAL,
          entryType: JournalEntryType.RECURRING,
          status: JournalEntryStatus.PENDING_APPROVAL,
          idempotencyKey,
          accountingPeriod: { id: period.id } as any,
          createdBy: recurring.createdBy,
        });
        const savedEntry = await manager.save(JournalEntry, entry);

        await manager.save(JournalEntryLine, [
          manager.create(JournalEntryLine, {
            journalEntry: { id: savedEntry.id } as any,
            account: { id: recurring.debitAccount.id } as any,
            entryType: JournalLineType.DEBIT,
            amount: recurring.amount,
          }),
          manager.create(JournalEntryLine, {
            journalEntry: { id: savedEntry.id } as any,
            account: { id: recurring.creditAccount.id } as any,
            entryType: JournalLineType.CREDIT,
            amount: recurring.amount,
          }),
        ]);

        recurring.lastGeneratedAt = now;
        recurring.nextDueAt = this.computeNextDue(now, recurring.frequency);
        await manager.save(RecurringEntry, recurring);
        await manager.query(`RELEASE SAVEPOINT "${savepoint}"`);
        generated++;
      } catch (err) {
        await manager.query(`ROLLBACK TO SAVEPOINT "${savepoint}"`);
        this.logger.error(
          `Failed to generate recurring entry for ${recurring.id}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Recurring entry scheduler: generated ${generated} draft entries`,
    );
  }

  private computeNextDue(from: Date, frequency: RecurringFrequency): Date {
    const next = new Date(from);
    switch (frequency) {
      case RecurringFrequency.WEEKLY:
        next.setDate(next.getDate() + 7);
        break;
      case RecurringFrequency.MONTHLY:
        next.setMonth(next.getMonth() + 1);
        break;
      case RecurringFrequency.QUARTERLY:
        next.setMonth(next.getMonth() + 3);
        break;
    }
    return next;
  }
}
