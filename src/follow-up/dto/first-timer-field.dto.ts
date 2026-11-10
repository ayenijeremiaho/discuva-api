import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { FirstTimerFieldType } from '../enums/follow-up.enum';

export class CreateFirstTimerFieldDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label: string;

  @IsEnum(FirstTimerFieldType)
  type: FirstTimerFieldType;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  options?: string[];

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsBoolean()
  inReport?: boolean;
}

export class UpdateFirstTimerFieldDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  options?: string[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsBoolean()
  inReport?: boolean;
}

export class ReorderFirstTimerFieldsDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  ids: string[];
}
