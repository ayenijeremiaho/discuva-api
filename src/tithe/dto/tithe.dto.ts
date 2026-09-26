import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CurrencyCode } from '../enum/tithe.enum';

export class CreateTitheAccountDto {
  @IsString()
  @IsNotEmpty()
  bankName: string;

  @IsString()
  @IsNotEmpty()
  accountNumber: string;

  @IsString()
  @IsNotEmpty()
  accountName: string;

  @IsEnum(CurrencyCode)
  currency: CurrencyCode;

  @IsString()
  @IsOptional()
  description?: string;
}

export class UpdateTitheAccountDto {
  @IsString()
  @IsOptional()
  bankName?: string;

  @IsString()
  @IsOptional()
  accountNumber?: string;

  @IsString()
  @IsOptional()
  accountName?: string;

  @IsEnum(CurrencyCode)
  @IsOptional()
  currency?: CurrencyCode;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class MatchUnmatchedDto {
  @IsUUID()
  @IsNotEmpty()
  memberId: string;
}

export class DownloadTitheDto {
  @IsNotEmpty()
  @IsUUID()
  memberId: string;
}

export class SubmitTitheProofDto {
  @IsUUID()
  @IsNotEmpty()
  titheAccountId: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsDateString()
  paymentDate: string;

  @IsString()
  @IsOptional()
  reference?: string;

  // Optional — what this payment was for. Omit for General Giving, same
  // convention as checkout's InitiateGivingCheckoutDto.
  @IsUUID()
  @IsOptional()
  givingOptionId?: string;
}

export class DeclineTitheProofDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  financeNote: string;
}
