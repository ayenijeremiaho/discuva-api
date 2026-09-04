import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
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

  // Relative to the slot's own startTime, same as
  // EventConfig.checkinStopOffsetSeconds — see CreateEventConfigDto. Must
  // be non-negative; the "can't exceed this slot's own duration" upper
  // bound is checked in EventService.buildSlotFromDto, where startTime/
  // endTime are both known.
  @IsOptional()
  @IsInt()
  @Min(0)
  checkinStopOverride?: number;

  @IsOptional()
  @IsInt()
  allowedDistanceOverride?: number;

  // Same "separate from distance-check" reasoning as
  // EventConfig.enforceMemberLocation — see CreateEventConfigDto.
  @IsOptional()
  @IsBoolean()
  enforceMemberLocationOverride?: boolean;

  /** Venue override for this specific slot. When omitted the slot uses config.defaultVenue. */
  @IsOptional()
  @IsUUID()
  venueOverrideId?: string;

  /** Format override for this specific slot. When omitted the slot uses config.defaultFormat. */
  @IsOptional()
  @IsEnum(MeetingFormatEnum)
  formatOverride?: MeetingFormatEnum;
}
