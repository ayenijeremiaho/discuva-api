import { EventAudienceEnum } from '../enums/event-audience.enum';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsUUID,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CreateServiceSlotDto } from './create-service-slot.dto';
import { EventRecurrencePatternEnum } from '../enums/event-recurrence-patterns.enums';
import { OmitType } from '@nestjs/mapped-types';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class SlotBlueprintDto extends OmitType(CreateServiceSlotDto, [
  'startTime',
  'endTime',
] as const) {
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be HH:mm' })
  startTime: string;

  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes: number;

  @IsInt()
  @Min(0)
  @Max(13)
  dayOffset: number;
}

export class UpdateEventSeriesDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  onlineAttendanceEnabled?: boolean;

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

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SlotBlueprintDto)
  slotBlueprint?: SlotBlueprintDto[];

  // Upcoming services on or after this church-local date take the change.
  @Matches(DATE, { message: 'effectiveFrom must be YYYY-MM-DD' })
  effectiveFrom: string;

  // Needed when services are added or removed: those upcoming dates are recreated.
  @IsOptional()
  @IsBoolean()
  confirmRecreate?: boolean;
}

export class StopEventSeriesDto {
  @Matches(DATE, { message: 'from must be YYYY-MM-DD' })
  from: string;
}

export class TemplateRecurrenceDto {
  @IsEnum(EventRecurrencePatternEnum)
  recurrencePattern: EventRecurrencePatternEnum;

  @IsInt()
  @Min(1)
  recurrenceInterval: number;

  @IsBoolean()
  ongoing: boolean;

  // 0 = Sunday; lets "new event from this type" suggest the next matching day.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  weekday?: number;
}

export class UpsertEventTemplateDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  onlineAttendanceEnabled?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SlotBlueprintDto)
  slotBlueprint: SlotBlueprintDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => TemplateRecurrenceDto)
  defaultRecurrence?: TemplateRecurrenceDto | null;

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
}
