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

  @IsInt()
  @Min(0)
  checkinStopOffsetSeconds: number;

  @IsNumber()
  @Min(5)
  allowedDistanceInMeters: number;

  @IsOptional()
  @IsBoolean()
  autoStartSession?: boolean;
}
