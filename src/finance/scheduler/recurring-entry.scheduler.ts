import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThanOrEqual, Repository } from 'typeorm';
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

@Injectable()
export class RecurringEntryScheduler {
  private static readonly LOCK_KEY = 'lock:finance-recurring-entries';
  private readonly logger = new Logger(RecurringEntryScheduler.name);

  constructor(
    @InjectRepository(RecurringEntry)
    private readonly recurringRepo: Repository<RecurringEntry>,
    @InjectRepository(AccountingPeriod)
    private readonly periodRepo: Repository<AccountingPeriod>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly cacheService: CacheService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM, { timeZone: CHURCH_TIMEZONE })
  async generateDueEntries(): Promise<void> {
    const acquired = await this.cacheService.acquireLock(
      RecurringEntryScheduler.LOCK_KEY,
      300,
    );
    if (!acquired) return;

    try {
      await this.run();
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

    let generated = 0;
    for (const recurring of dueEntries) {
      try {
        const idempotencyKey = `recurring-${recurring.id}-${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
        await this.dataSource.transaction(async (manager) => {
          const existing = await manager.findOne(JournalEntry, {
            where: { idempotencyKey },
          });
          if (existing) return;

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
          generated++;
        });
      } catch (err) {
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
