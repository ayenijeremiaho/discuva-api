import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  AccountSubtype,
  AccountType,
  NormalBalance,
} from '../enum/finance.enum';

export class CreateAccountDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  code?: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(AccountType)
  type: AccountType;

  @IsEnum(AccountSubtype)
  subtype: AccountSubtype;

  @IsEnum(NormalBalance)
  normalBalance: NormalBalance;

  @IsOptional()
  @IsUUID()
  fundId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  lowBalanceAlertThreshold?: number;
}

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsEnum(AccountSubtype)
  subtype?: AccountSubtype;

  @IsOptional()
  @IsUUID()
  fundId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  lowBalanceAlertThreshold?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AccountQueryDto {
  @IsOptional()
  @IsEnum(AccountType)
  type?: AccountType;

  @IsOptional()
  @IsEnum(AccountSubtype)
  subtype?: AccountSubtype;

  @IsOptional()
  @IsUUID()
  fundId?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;
}
