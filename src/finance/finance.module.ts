import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { Fund } from './entity/fund.entity';
import { AccountingPeriod } from './entity/accounting-period.entity';
import { Account } from './entity/account.entity';
import { ExternalPayee } from './entity/external-payee.entity';
import { JournalEntry } from './entity/journal-entry.entity';
import { JournalEntryLine } from './entity/journal-entry-line.entity';
import { JournalEntryLink } from './entity/journal-entry-link.entity';
import { Offering } from './entity/offering.entity';
import { Budget } from './entity/budget.entity';
import { PledgeCampaign } from './entity/pledge-campaign.entity';
import { Pledge } from './entity/pledge.entity';
import { PledgeContribution } from './entity/pledge-contribution.entity';
import { RecurringEntry } from './entity/recurring-entry.entity';
import { PettyCashReplenishment } from './entity/petty-cash-replenishment.entity';
import { BulkUploadJob } from './entity/bulk-upload-job.entity';
import { ReconciliationRow } from './entity/reconciliation-row.entity';
import { MemberVirtualAccount } from './entity/member-virtual-account.entity';
import { BankImportProfile } from './entity/bank-import-profile.entity';
import { Member } from '../member/entity/member.entity';
import { TitheRecord } from '../tithe/entity/tithe-record.entity';
import { FundService } from './service/fund.service';
import { AccountingPeriodService } from './service/accounting-period.service';
import { AccountService } from './service/account.service';
import { ExternalPayeeService } from './service/external-payee.service';
import { JournalEntryService } from './service/journal-entry.service';
import { OfferingService } from './service/offering.service';
import { BudgetService } from './service/budget.service';
import { PledgeService } from './service/pledge.service';
import { RecurringEntryService } from './service/recurring-entry.service';
import { PettyCashService } from './service/petty-cash.service';
import { ReconciliationService } from './service/reconciliation.service';
import { FinanceReportService } from './service/finance-report.service';
import { BankImportProfileService } from './service/bank-import-profile.service';
import { FundController } from './controller/fund.controller';
import { AccountingPeriodController } from './controller/accounting-period.controller';
import { AccountController } from './controller/account.controller';
import { ExternalPayeeController } from './controller/external-payee.controller';
import { JournalEntryController } from './controller/journal-entry.controller';
import { OfferingController } from './controller/offering.controller';
import { BudgetController } from './controller/budget.controller';
import { PledgeController } from './controller/pledge.controller';
import { RecurringEntryController } from './controller/recurring-entry.controller';
import { PettyCashController } from './controller/petty-cash.controller';
import { ReconciliationController } from './controller/reconciliation.controller';
import { FinanceReportController } from './controller/finance-report.controller';
import { BankImportProfileController } from './controller/bank-import-profile.controller';
import {
  RECONCILIATION_QUEUE,
  ReconciliationProcessor,
} from './processor/reconciliation.processor';
import { RecurringEntryScheduler } from './scheduler/recurring-entry.scheduler';
import { AnnualGivingStatementScheduler } from './scheduler/annual-giving-statement.scheduler';
import { BudgetAlertScheduler } from './scheduler/budget-alert.scheduler';
import { PledgeReminderScheduler } from './scheduler/pledge-reminder.scheduler';
import { GivingService } from './service/giving.service';
import { FinanceMemberController } from './controller/finance-member.controller';
import { UtilityModule } from '../utility/utility.module';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Fund,
      AccountingPeriod,
      Account,
      ExternalPayee,
      JournalEntry,
      JournalEntryLine,
      JournalEntryLink,
      Offering,
      Budget,
      PledgeCampaign,
      Pledge,
      PledgeContribution,
      RecurringEntry,
      PettyCashReplenishment,
      BulkUploadJob,
      ReconciliationRow,
      MemberVirtualAccount,
      BankImportProfile,
      Member,
      TitheRecord,
    ]),
    BullModule.registerQueue({ name: RECONCILIATION_QUEUE }),
    UtilityModule,
    AdminModule,
  ],
  providers: [
    FundService,
    AccountingPeriodService,
    AccountService,
    ExternalPayeeService,
    JournalEntryService,
    OfferingService,
    BudgetService,
    PledgeService,
    RecurringEntryService,
    PettyCashService,
    ReconciliationService,
    FinanceReportService,
    BankImportProfileService,
    ReconciliationProcessor,
    RecurringEntryScheduler,
    AnnualGivingStatementScheduler,
    BudgetAlertScheduler,
    PledgeReminderScheduler,
    GivingService,
  ],
  controllers: [
    FundController,
    AccountingPeriodController,
    AccountController,
    ExternalPayeeController,
    JournalEntryController,
    OfferingController,
    BudgetController,
    PledgeController,
    RecurringEntryController,
    PettyCashController,
    ReconciliationController,
    FinanceReportController,
    BankImportProfileController,
    FinanceMemberController,
  ],
  exports: [TypeOrmModule],
})
export class FinanceModule {}
