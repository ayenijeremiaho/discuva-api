import {
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MeetingFormatEnum } from '../../utility/enum/meeting-format.enum';
import { MeetingFrequencyEnum } from '../enum/meeting-frequency.enum';

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

// When and how often a fellowship meets; each field is checked here, the combination in assertValidSchedule.
export class MeetingScheduleDto {
  @IsOptional()
  @IsEnum(MeetingFrequencyEnum)
  meetingFrequency?: MeetingFrequencyEnum;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  meetingWeekday?: number | null;

  @IsOptional()
  @Matches(HH_MM, { message: 'meetingStartTime must be HH:mm' })
  meetingStartTime?: string | null;

  @IsOptional()
  @Matches(HH_MM, { message: 'meetingEndTime must be HH:mm' })
  meetingEndTime?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  meetingIntervalWeeks?: number;

  @IsOptional()
  @IsIn([1, 2, 3, 4, -1])
  meetingWeekOfMonth?: number | null;

  @IsOptional()
  @Matches(YMD, { message: 'meetingStartsOn must be YYYY-MM-DD' })
  meetingStartsOn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  meetingNotes?: string | null;
}

// What a fellowship's leader can change: when, where and how it meets.
export class LeaderUpdateSmallGroupDto extends MeetingScheduleDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  meetingLocation?: string | null;

  @IsOptional()
  @IsEnum(MeetingFormatEnum)
  meetingFormat?: MeetingFormatEnum;

  @IsOptional()
  @IsUrl()
  meetingLink?: string | null;
}

export class CreateSmallGroupDto extends MeetingScheduleDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  leaderId?: string;

  @IsOptional()
  @IsString()
  meetingDay?: string;

  @IsOptional()
  @IsString()
  meetingLocation?: string;

  @IsOptional()
  @IsUUID()
  venueId?: string;

  @IsOptional()
  @IsEnum(MeetingFormatEnum)
  meetingFormat?: MeetingFormatEnum;

  @IsOptional()
  @IsUrl()
  meetingLink?: string;
}

export class UpdateSmallGroupDto extends MeetingScheduleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  leaderId?: string;

  @IsOptional()
  @IsString()
  meetingDay?: string;

  @IsOptional()
  @IsString()
  meetingLocation?: string;

  @IsOptional()
  @IsUUID()
  venueId?: string | null;

  @IsOptional()
  @IsEnum(MeetingFormatEnum)
  meetingFormat?: MeetingFormatEnum;

  @IsOptional()
  @IsUrl()
  meetingLink?: string;
}
