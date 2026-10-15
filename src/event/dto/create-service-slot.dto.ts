import { CheckinCloseModeEnum } from '../enums/checkin-close-mode.enum';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator';
import { MeetingFormatEnum } from '../../utility/enum/meeting-format.enum';
import { EventAudienceEnum } from '../enums/event-audience.enum';

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

  // Overrides the config's close rule for this one service.
  @IsOptional()
  @IsEnum(CheckinCloseModeEnum)
  checkinCloseModeOverride?: CheckinCloseModeEnum;

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

  // Only narrows the event's audience for this service — omit for "whoever the event is for".
  @IsOptional()
  @IsIn([EventAudienceEnum.WORKERS, EventAudienceEnum.GROUP])
  audience?: EventAudienceEnum.WORKERS | EventAudienceEnum.GROUP;

  @ValidateIf((o) => o.audience === EventAudienceEnum.GROUP)
  @IsUUID()
  audienceGroupId?: string;
}
