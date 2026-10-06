import { EventAudienceEnum } from '../enums/event-audience.enum';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsUUID,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EventRecurrencePatternEnum } from '../enums/event-recurrence-patterns.enums';
import { CreateServiceSlotDto } from './create-service-slot.dto';

class RecurrenceDto {
  // Ongoing series keep themselves topped up; otherwise an end date is required.
  @IsOptional()
  @IsBoolean()
  ongoing?: boolean;

  @ValidateIf((o: RecurrenceDto) => !o.ongoing)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'recurrenceEndDate must be YYYY-MM-DD',
  })
  recurrenceEndDate?: string;

  @IsEnum(EventRecurrencePatternEnum)
  recurrencePattern: EventRecurrencePatternEnum;

  @Min(1)
  @IsInt()
  recurrenceInterval: number;
}

export class CreateEventDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'At least one service slot is required' })
  @ValidateNested({ each: true })
  @Type(() => CreateServiceSlotDto)
  serviceSlots: CreateServiceSlotDto[];

  @IsOptional()
  @IsBoolean()
  onlineAttendanceEnabled?: boolean;

  @IsBoolean()
  isRecurring: boolean;

  // Prepare a draft programme for each service that has a matching programme template (default on).
  @IsOptional()
  @IsBoolean()
  autoProgramme?: boolean;

  // Who the event is for (default everyone). GROUP needs audienceGroupId.
  @IsOptional()
  @IsEnum(EventAudienceEnum)
  audience?: EventAudienceEnum;

  @ValidateIf((o) => o.audience === EventAudienceEnum.GROUP)
  @IsUUID()
  audienceGroupId?: string;

  @ValidateIf((o) => o.isRecurring)
  @ValidateNested()
  @Type(() => RecurrenceDto)
  recurrence?: RecurrenceDto;
}
