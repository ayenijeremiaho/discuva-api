import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  PrayerAudience,
  PrayerDayMode,
  PrayerRuleType,
} from '../enum/prayer.enum';
import { DepartmentLeadTypeEnum } from '../../department/enums/department-lead-type.enum';

export class CreatePrayerProgramDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(PrayerAudience)
  audience: PrayerAudience;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  selectionWindowDays?: number;
}

export class UpdatePrayerProgramDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(PrayerAudience)
  audience?: PrayerAudience;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  selectionWindowDays?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ClonePrayerProgramDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(PrayerAudience)
  audience?: PrayerAudience;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  selectionWindowDays?: number;

  @IsOptional()
  @IsBoolean()
  includeFixedAssignments?: boolean;
}

export class UpsertPrayerScheduleConfigDto {
  @IsInt()
  @Min(1)
  @Max(30)
  selectionWindowDays: number;
}

export class CreatePrayerDayConfigDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @IsEnum(PrayerDayMode)
  mode: PrayerDayMode;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be HH:MM' })
  startTime: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'endTime must be HH:MM' })
  endTime: string;

  @IsInt()
  @Min(1)
  maxCapacity: number;
}

export class UpdatePrayerDayConfigDto {
  @IsOptional()
  @IsEnum(PrayerDayMode)
  mode?: PrayerDayMode;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be HH:MM' })
  startTime?: string;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'endTime must be HH:MM' })
  endTime?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxCapacity?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreatePrayerScheduleRuleDto {
  @IsEnum(PrayerRuleType)
  type: PrayerRuleType;

  @IsOptional()
  @IsEnum(DepartmentLeadTypeEnum)
  targetLeadType?: DepartmentLeadTypeEnum;

  @IsInt()
  @Min(1)
  value: number;

  @IsString()
  @IsNotEmpty()
  description: string;
}

export class UpdatePrayerScheduleRuleDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  value?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreatePrayerFixedAssignmentDto {
  @IsUUID()
  workerProfileId: string;

  @IsUUID()
  dayConfigId: string;
}

export class GenerateMonthlyMeetingsDto {
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @IsInt()
  @Min(2024)
  year: number;
}

export class OpenSelectionWindowDto {
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @IsInt()
  @Min(2024)
  year: number;
}

export class SelfSelectPrayerSlotDto {
  @IsUUID()
  meetingId: string;
}

export class ReschedulePrayerEntryDto {
  @IsUUID()
  newMeetingId: string;
}

export class ManualAssignDto {
  @IsUUID()
  meetingId: string;

  @IsOptional()
  @IsUUID()
  workerProfileId?: string;

  @IsOptional()
  @IsUUID()
  memberId?: string;

  @ValidateIf((o) => !o.workerProfileId && !o.memberId)
  @IsUUID()
  _requireOne?: string;
}
