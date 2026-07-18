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
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PledgeFrequency, PledgeStatus } from '../enum/finance.enum';

export class CreatePledgeCampaignDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsUUID()
  fundId: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  targetAmount: number;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateCampaignActiveDto {
  @IsBoolean()
  isActive: boolean;
}

export class CreatePledgeDto {
  @ValidateIf((o) => !o.guestName)
  @IsUUID()
  memberId?: string;

  @ValidateIf((o) => !o.memberId)
  @IsString()
  @IsNotEmpty()
  guestName?: string;

  @IsUUID()
  campaignId: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  totalAmount: number;

  @IsEnum(PledgeFrequency)
  frequency: PledgeFrequency;

  @IsDateString()
  startDate: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdatePledgeStatusDto {
  @IsEnum(PledgeStatus)
  status: PledgeStatus;
}

export class MakePledgeDto {
  @IsUUID()
  campaignId: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  totalAmount: number;

  @IsEnum(PledgeFrequency)
  frequency: PledgeFrequency;

  @IsDateString()
  startDate: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class PledgeQueryDto {
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
  campaignId?: string;

  @IsOptional()
  @IsUUID()
  memberId?: string;

  @IsOptional()
  @IsEnum(PledgeStatus)
  status?: PledgeStatus;
}
