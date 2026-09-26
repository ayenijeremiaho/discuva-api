import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateOfferingDto {
  @IsOptional()
  @IsUUID()
  serviceEventId?: string;

  // Optional — falls back to the selected GivingOption's own fund when
  // omitted; required only when that option has none configured.
  @IsOptional()
  @IsUUID()
  fundId?: string;

  // Optional — omitting it means "General Giving", same as checkout's
  // InitiateGivingCheckoutDto: there's no seeded "General Giving" row, null
  // just displays as that. fundId becomes required in that case since there's
  // no GivingOption to derive one from.
  @IsOptional()
  @IsUUID()
  givingOptionId?: string;

  // Who physically brought this giving, if known — omit for
  // anonymous/basket collections.
  @IsOptional()
  @IsUUID()
  memberId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cashAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  expectedTransferAmount?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class OfferingQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @IsOptional()
  @IsUUID()
  fundId?: string;

  @IsOptional()
  @IsUUID()
  givingOptionId?: string;

  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @IsOptional()
  @IsDateString()
  toDate?: string;
}

export class ReconcileOfferingDto {
  @IsString()
  @IsNotEmpty()
  notes: string;

  @IsOptional()
  @IsBoolean()
  autoJournal?: boolean;

  @ValidateIf((o) => o.autoJournal === true)
  @IsUUID()
  debitAccountId?: string;

  @ValidateIf((o) => o.autoJournal === true)
  @IsUUID()
  creditAccountId?: string;

  @ValidateIf((o) => o.autoJournal === true)
  @IsUUID()
  accountingPeriodId?: string;
}
