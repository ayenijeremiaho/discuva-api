import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ClassSessionModeEnum } from '../enum/class-session-mode.enum';
import { ClassAttendanceStatusEnum } from '../enum/class-attendance-status.enum';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

class SessionDetailsDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(120)
  title?: string | null;

  @IsOptional()
  @IsEnum(ClassSessionModeEnum)
  mode?: ClassSessionModeEnum;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(200)
  location?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsUrl()
  meetingLink?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class CreateClassSessionDto extends SessionDetailsDto {
  @IsISO8601()
  startsAt: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsISO8601()
  endsAt?: string | null;
}

export class UpdateClassSessionScheduleDto extends SessionDetailsDto {
  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsISO8601()
  endsAt?: string | null;
}

// Every N weeks from startDate to endDate at the same local time (church timezone).
export class CreateClassSessionSeriesDto extends SessionDetailsDto {
  @Matches(DATE, { message: 'startDate must be YYYY-MM-DD' })
  startDate: string;

  @Matches(DATE, { message: 'endDate must be YYYY-MM-DD' })
  endDate: string;

  @Matches(TIME, { message: 'time must be HH:mm (24-hour)' })
  time: string;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(720)
  durationMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  everyWeeks?: number;
}

export class ClassAttendanceEntryDto {
  @IsUUID()
  enrollmentId: string;

  @IsEnum(ClassAttendanceStatusEnum)
  status: ClassAttendanceStatusEnum;
}

export class MarkClassAttendanceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ClassAttendanceEntryDto)
  attendances: ClassAttendanceEntryDto[];
}
