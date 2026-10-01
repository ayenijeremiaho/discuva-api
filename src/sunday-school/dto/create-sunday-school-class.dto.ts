import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { MeetingDayEnum } from '../enums/meeting-day.enum';

// null clears a detail on update.
class SundaySchoolClassDetailsDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(60)
  ageGroup?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEnum(MeetingDayEnum)
  meetingDay?: MeetingDayEnum | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'meetingTime must be HH:mm (24-hour)',
  })
  meetingTime?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(120)
  location?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  assistantIds?: string[];
}

export class CreateSundaySchoolClassDto extends SundaySchoolClassDetailsDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsUUID('4')
  @IsOptional()
  teacherId?: string;
}

export class UpdateSundaySchoolClassDto extends SundaySchoolClassDetailsDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsUUID('4')
  @IsOptional()
  teacherId?: string;
}
