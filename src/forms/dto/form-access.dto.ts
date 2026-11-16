import { Type } from 'class-transformer';
import { FormResultsAccess } from '../enum/form.enum';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsUUID,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class FormAccessQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit = 20;

  @IsString()
  @MaxLength(200)
  @IsOptional()
  search?: string;
}

export class SetFormAccessDto {
  @IsBoolean()
  canView: boolean;

  @IsBoolean()
  canExport: boolean;
}

export class SetResultsAccessDto {
  @IsEnum(FormResultsAccess)
  resultsAccess: FormResultsAccess;
}

export class ShareFormWithManyDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  adminIds: string[];

  @IsBoolean()
  canExport: boolean;
}

export class ShareManyFormsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  formIds: string[];

  @IsBoolean()
  canExport: boolean;
}
