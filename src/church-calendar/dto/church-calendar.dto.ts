import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsHexColor,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';

// Envelope validation only — each entry's date must additionally fall
// within the calendar's own [startDate, endDate], which is a
// cross-field check the decorator layer can't express, so
// ChurchCalendarService.assertValidEntries checks it in the service, the
// same "structural validation the DTO can't express" pattern
// FormService.assertValidPostSubmitOutcomes/PageService.assertValidSections
// already use for their own jsonb array content.
export class ChurchCalendarEntryDto {
  @IsUUID()
  id: string;

  @IsDateString()
  date: string;

  // 24-hour 'HH:mm' — optional, an all-day/time-TBD entry omits it.
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'time must be in 24-hour HH:mm format',
  })
  time?: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;
}

export class CreateChurchCalendarDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  theme?: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsHexColor()
  accentColor?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChurchCalendarEntryDto)
  entries: ChurchCalendarEntryDto[];
}

export class UpdateChurchCalendarDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @IsOptional()
  @IsString()
  theme?: string | null;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsHexColor()
  accentColor?: string | null;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  // Omitted = leave untouched; an array = replace the whole list wholesale
  // — same convention as Page.sections/Form.postSubmitOutcomes (no
  // per-entry id to diff against).
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, {
    message: 'A published calendar needs at least one entry',
  })
  @ValidateNested({ each: true })
  @Type(() => ChurchCalendarEntryDto)
  entries?: ChurchCalendarEntryDto[];
}
