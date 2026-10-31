import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  RotaAllocationMode,
  RotaScheduleType,
} from '../enum/rota-allocation-mode.enum';

export class SaveRotaSubteamDto {
  @IsString()
  @Length(1, 100)
  name: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}

export class SaveRotaResponsibilityDto {
  @IsString()
  @Length(1, 80)
  name: string;

  @IsOptional()
  @IsUUID()
  subteamId?: string | null;

  @IsInt()
  @Min(1)
  @Max(50)
  requiredCount: number;

  @IsEnum(RotaAllocationMode)
  allocationMode: RotaAllocationMode;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}

export class RotaEligibilityEntryDto {
  @IsUUID()
  memberId: string;

  @IsOptional()
  @IsBoolean()
  isFixed?: boolean;
}

export class SaveRotaEligibilityDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => RotaEligibilityEntryDto)
  members: RotaEligibilityEntryDto[];
}

export class RotaPlannerEntryDto {
  @IsUUID()
  memberId: string;

  @IsOptional()
  @IsUUID()
  subteamId?: string | null;

  @IsBoolean()
  canPublish: boolean;
}

export class SaveRotaPlannersDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => RotaPlannerEntryDto)
  planners: RotaPlannerEntryDto[];
}

export class SaveRotaScheduleDto {
  @IsString()
  @Length(1, 100)
  name: string;

  @IsEnum(RotaScheduleType)
  scheduleType: RotaScheduleType;

  @IsEnum(RotaAllocationMode)
  allocationMode: RotaAllocationMode;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number | null;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  startTime?: string | null;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  endTime?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}
