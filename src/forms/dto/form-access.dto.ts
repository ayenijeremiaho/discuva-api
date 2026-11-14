import { Type } from 'class-transformer';
import {
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
