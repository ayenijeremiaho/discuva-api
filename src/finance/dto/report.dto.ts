import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { AccountSubtype } from '../enum/finance.enum';

export class PeriodReportQueryDto {
  @IsOptional()
  @IsUUID()
  periodId?: string;

  @IsOptional()
  @IsUUID()
  fundId?: string;
}

export class AccountReportQueryDto {
  @IsUUID()
  accountId: string;

  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @IsOptional()
  @IsDateString()
  toDate?: string;
}

export class MemberGivingQueryDto {
  @IsUUID()
  memberId: string;

  @IsOptional()
  @IsUUID()
  periodId?: string;

  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @IsOptional()
  @IsDateString()
  toDate?: string;

  @IsOptional()
  @IsEnum(AccountSubtype)
  accountSubtype?: AccountSubtype;
}

export class BudgetActualsQueryDto {
  @IsUUID()
  budgetId: string;
}

export class PledgeSummaryQueryDto {
  @IsUUID()
  campaignId: string;

  // Optional: adds how much was paid within this range alongside the all-time totals.
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @IsOptional()
  @IsDateString()
  toDate?: string;
}
