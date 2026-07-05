import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { PartialType, PickType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { BudgetPeriod } from '../enum/finance.enum';

export class CreateBudgetDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsUUID()
  fundId: string;

  @IsUUID()
  accountId: string;

  @IsEnum(BudgetPeriod)
  period: BudgetPeriod;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;
}

export class UpdateBudgetDto extends PartialType(
  PickType(CreateBudgetDto, ['name', 'amount', 'startDate', 'endDate'] as const),
) {}

export class BudgetQueryDto {
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
  @IsEnum(BudgetPeriod)
  period?: BudgetPeriod;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;
}
