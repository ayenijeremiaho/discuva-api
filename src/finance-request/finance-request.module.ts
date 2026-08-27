import { Module } from '@nestjs/common';
import { TenantTypeOrmModule } from '../tenant/utility/tenant-typeorm.module';
import { FinanceCategory } from './entity/finance-category.entity';
import { FinanceRequest } from './entity/finance-request.entity';
import { FinanceRequestService } from './service/finance-request.service';
import { FinanceAdminController } from './controller/finance-admin.controller';
import { FinanceWorkerController } from './controller/finance-worker.controller';
import { AdminModule } from '../admin/admin.module';
import { DepartmentModule } from '../department/department.module';
import { UtilityModule } from '../utility/utility.module';
import { JournalEntry } from '../finance/entity/journal-entry.entity';
import { JournalEntryLine } from '../finance/entity/journal-entry-line.entity';
import { JournalEntryLink } from '../finance/entity/journal-entry-link.entity';
import { AccountingPeriod } from '../finance/entity/accounting-period.entity';
import { Account } from '../finance/entity/account.entity';

@Module({
  imports: [
    TenantTypeOrmModule.forFeature([
      FinanceCategory,
      FinanceRequest,
      JournalEntry,
      JournalEntryLine,
      JournalEntryLink,
      AccountingPeriod,
      Account,
    ]),
    AdminModule,
    DepartmentModule,
    UtilityModule,
  ],
  controllers: [FinanceAdminController, FinanceWorkerController],
  providers: [FinanceRequestService],
})
export class FinanceRequestModule {}
