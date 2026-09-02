import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { MeetingFormatEnum } from '../../utility/enum/meeting-format.enum';

export class CreateServiceSlotDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsDateString()
  startTime: string;

  @IsDateString()
  endTime: string;

  @IsOptional()
  @IsUUID()
  configId?: string;

  @IsOptional()
  @IsInt()
  workerCheckinStartOverride?: number;

  @IsOptional()
  @IsInt()
  workerLateOverride?: number;

  @IsOptional()
  @IsInt()
  memberCheckinStartOverride?: number;

  @IsOptional()
  @IsInt()
  checkinStopOverride?: number;

  @IsOptional()
  @IsInt()
  allowedDistanceOverride?: number;

  /** Venue override for this specific slot. When omitted the slot uses config.defaultVenue. */
  @IsOptional()
  @IsUUID()
  venueOverrideId?: string;

  /** Format override for this specific slot. When omitted the slot uses config.defaultFormat. */
  @IsOptional()
  @IsEnum(MeetingFormatEnum)
  formatOverride?: MeetingFormatEnum;
}
