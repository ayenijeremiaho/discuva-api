import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
} from 'class-validator';
import { MeetingFormatEnum } from '../../utility/enum/meeting-format.enum';

export class CreateSmallGroupDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  leaderId?: string;

  @IsOptional()
  @IsString()
  meetingDay?: string;

  @IsOptional()
  @IsString()
  meetingLocation?: string;

  @IsOptional()
  @IsUUID()
  venueId?: string;

  @IsOptional()
  @IsEnum(MeetingFormatEnum)
  meetingFormat?: MeetingFormatEnum;

  @IsOptional()
  @IsUrl()
  meetingLink?: string;
}

export class UpdateSmallGroupDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  leaderId?: string;

  @IsOptional()
  @IsString()
  meetingDay?: string;

  @IsOptional()
  @IsString()
  meetingLocation?: string;

  @IsOptional()
  @IsUUID()
  venueId?: string | null;

  @IsOptional()
  @IsEnum(MeetingFormatEnum)
  meetingFormat?: MeetingFormatEnum;

  @IsOptional()
  @IsUrl()
  meetingLink?: string;
}
