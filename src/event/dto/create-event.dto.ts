import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
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
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'recurrenceEndDate must be YYYY-MM-DD',
  })
  recurrenceEndDate: string;

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

  @ValidateIf((o) => o.isRecurring)
  @ValidateNested()
  @Type(() => RecurrenceDto)
  recurrence?: RecurrenceDto;
}
