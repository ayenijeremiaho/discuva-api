import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateFinanceCategoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;
}

export class UpdateFinanceCategoryDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;
}

export class CreateFinanceRequestDto {
  @IsUUID()
  @IsNotEmpty()
  categoryId: string;

  @IsUUID()
  @IsNotEmpty()
  departmentId: string;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  amount: number;

  @IsString()
  @IsNotEmpty()
  recipientBankName: string;

  @IsString()
  @IsNotEmpty()
  recipientAccountNumber: string;

  @IsString()
  @IsNotEmpty()
  recipientAccountName: string;
}

export class RejectFinanceRequestDto {
  @IsString()
  @IsNotEmpty()
  rejectionReason: string;
}

export class AttachProofDto {
  // Bound via @Body() on a multipart/form-data request, so this arrives as
  // the string "true"/"false", not a boolean — @Type(() => Boolean) would
  // coerce the string "false" to true. Explicit Transform instead.
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  postToJournal?: boolean = false;

  @ValidateIf((o: AttachProofDto) => o.postToJournal === true)
  @IsUUID()
  debitAccountId?: string;

  @ValidateIf((o: AttachProofDto) => o.postToJournal === true)
  @IsUUID()
  creditAccountId?: string;
}
