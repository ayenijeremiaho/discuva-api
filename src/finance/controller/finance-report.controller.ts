import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { PlanGuard } from '../../billing/guard/plan.guard';
import { RequiresPlan } from '../../billing/decorator/requires-plan.decorator';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';
import { FinanceReportService } from '../service/finance-report.service';
import {
  AccountReportQueryDto,
  BudgetActualsQueryDto,
  MemberGivingQueryDto,
  PeriodReportQueryDto,
  PledgeSummaryQueryDto,
} from '../dto/report.dto';

@UseGuards(AdminGuard, PlanGuard)
@RequiresPlan(PlanFeature.FINANCE)
@Controller('admin/finance/reports')
export class FinanceReportController {
  constructor(private readonly reportService: FinanceReportService) {}

  @RequiresPermission(AdminPermission.FINANCE_REPORT)
  @Get('income-expense')
  incomeExpense(@Query() query: PeriodReportQueryDto) {
    return this.reportService.incomeExpense(query.periodId, query.fundId);
  }

  @RequiresPermission(AdminPermission.FINANCE_REPORT)
  @Get('cash-flow')
  cashFlow(@Query() query: AccountReportQueryDto) {
    return this.reportService.cashFlow(
      query.accountId,
      query.fromDate,
      query.toDate,
    );
  }

  @RequiresPermission(AdminPermission.FINANCE_REPORT)
  @Get('trial-balance')
  trialBalance(@Query() query: PeriodReportQueryDto) {
    return this.reportService.trialBalance(query.periodId);
  }

  @RequiresPermission(AdminPermission.FINANCE_REPORT)
  @Get('fund-balance')
  fundBalance() {
    return this.reportService.fundBalance();
  }

  @RequiresPermission(AdminPermission.FINANCE_REPORT)
  @Get('account-ledger')
  accountLedger(@Query() query: AccountReportQueryDto) {
    return this.reportService.accountLedger(
      query.accountId,
      query.fromDate,
      query.toDate,
    );
  }

  @RequiresPermission(AdminPermission.FINANCE_REPORT)
  @Get('budget-actuals')
  budgetActuals(@Query() query: BudgetActualsQueryDto) {
    return this.reportService.budgetActuals(query.budgetId);
  }

  @RequiresPermission(AdminPermission.FINANCE_REPORT)
  @Get('pledge-summary')
  pledgeSummary(@Query() query: PledgeSummaryQueryDto) {
    return this.reportService.pledgeSummary(query.campaignId);
  }

  @RequiresPermission(AdminPermission.TITHE_READ)
  @Get('member-giving')
  memberGiving(@Query() query: MemberGivingQueryDto) {
    return this.reportService.memberGiving(
      query.memberId,
      query.periodId,
      query.fromDate,
      query.toDate,
      query.accountSubtype,
    );
  }

  @RequiresPermission(AdminPermission.FINANCE_REPORT)
  @Get('dashboard')
  dashboard() {
    return this.reportService.dashboard();
  }
}
