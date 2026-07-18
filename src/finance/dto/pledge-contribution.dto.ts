import {
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
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PledgeContributionStatus } from '../enum/finance.enum';

export class SubmitPledgeContributionDto {
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsDateString()
  paymentDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reference?: string;
}

export class DeclinePledgeContributionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  financeNote: string;
}

export class PledgeContributionQueryDto {
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
  @IsEnum(PledgeContributionStatus)
  status?: PledgeContributionStatus;

  @IsOptional()
  @IsUUID()
  pledgeId?: string;

  @IsOptional()
  @IsUUID()
  campaignId?: string;
}
