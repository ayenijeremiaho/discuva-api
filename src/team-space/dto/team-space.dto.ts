import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { RsvpResponseEnum } from '../entity/team-meeting-rsvp.entity';
import { Transform } from 'class-transformer';
import {
  POST_MAX_LENGTH,
  REPLY_MAX_LENGTH,
} from '../constant/team-space.constant';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class PostBodyDto {
  @Transform(trim)
  @IsString()
  @Length(1, POST_MAX_LENGTH)
  body: string;
}

export class ReplyBodyDto {
  @Transform(trim)
  @IsString()
  @Length(1, REPLY_MAX_LENGTH)
  body: string;
}

export class PinPostDto {
  @IsBoolean()
  pinned: boolean;
}

export class SpaceSettingsDto {
  @IsBoolean()
  leadersOnly: boolean;
}

export class CreateMeetingDto {
  @IsString()
  @Length(2, 120)
  title: string;

  @IsDateString()
  startsAt: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  onlineLink?: string;

  @IsOptional()
  @IsString()
  @MaxLength(POST_MAX_LENGTH)
  agenda?: string;
}

export class UpdateMeetingDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  title?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  onlineLink?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(POST_MAX_LENGTH)
  agenda?: string;

  @IsOptional()
  @IsBoolean()
  cancel?: boolean;
}

export class RsvpDto {
  @IsEnum(RsvpResponseEnum)
  response: RsvpResponseEnum;
}

export class MinutesDto {
  @IsString()
  @MaxLength(10000)
  minutes: string;
}

export class AttendanceDto {
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(1000)
  memberIds: string[];
}

export class CreatePollDto {
  @IsString()
  @Length(3, 300)
  question: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  options: string[];

  @IsOptional()
  @IsBoolean()
  multiple?: boolean;

  @IsOptional()
  @IsDateString()
  closesAt?: string;
}

export class VoteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  optionIds: string[];
}
