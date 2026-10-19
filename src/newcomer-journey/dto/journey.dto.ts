import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class SaveJourneySettingsDto {
  // null keeps the default: the church's first class and the classes that follow it.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsUUID('all', { each: true })
  classTypeIds?: string[] | null;

  @Type(() => Number)
  @IsInt()
  @Min(3)
  @Max(180)
  stuckAfterDays: number;
}

export class JourneyRangeQueryDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}

export class JourneyStuckQueryDto extends JourneyRangeQueryDto {
  @IsString()
  step: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
