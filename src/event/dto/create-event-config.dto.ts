import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { MeetingFormatEnum } from '../../utility/enum/meeting-format.enum';

export class CreateEventConfigDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  // Required when defaultFormat is IN_PERSON (the default), must be
  // omitted when ONLINE — enforced in EventConfigService, not here, since
  // that depends on the sibling defaultFormat field.
  @IsOptional()
  @IsUUID()
  defaultVenueId?: string;

  @IsOptional()
  @IsEnum(MeetingFormatEnum)
  defaultFormat?: MeetingFormatEnum;

  @IsOptional()
  @IsString()
  onlineMeetingUrl?: string;

  @IsInt()
  @Max(-1)
  workerCheckinStartOffsetSeconds: number;

  @IsInt()
  @Min(0)
  workerLateOffsetSeconds: number;

  @IsInt()
  @Max(-1)
  memberCheckinStartOffsetSeconds: number;

  // Relative to the slot's startTime (see AttendanceService.validateCheckinWindow),
  // not endTime — must be non-negative so check-in can't close before it
  // even opens. The upper bound (must not exceed slot duration, so
  // check-in can't stay open past the slot's own end) can only be checked
  // once a specific slot's duration is known — see EventService.buildSlotFromDto.
  @IsInt()
  @Min(0)
  checkinStopOffsetSeconds: number;

  @IsNumber()
  @Min(5)
  allowedDistanceInMeters: number;

  @IsOptional()
  @IsBoolean()
  autoStartSession?: boolean;

  // Separate from the tenant-wide distance-check-enforcement setting — see
  // EventConfig.enforceMemberLocation. A slot can override this via
  // CreateServiceSlotDto.enforceMemberLocationOverride.
  @IsOptional()
  @IsBoolean()
  enforceMemberLocation?: boolean;
}
