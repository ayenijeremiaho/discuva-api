import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Length,
  MaxLength,
} from 'class-validator';
import { RsvpResponseEnum } from '../entity/team-meeting-rsvp.entity';
import { SharedSpaceAudienceEnum } from '../entity/shared-space.entity';
import { ReportOutcomeEnum } from '../entity/post-report.entity';
import { Transform } from 'class-transformer';
import {
  POST_MAX_LENGTH,
  MUTE_DAYS,
  POST_TITLE_MAX_LENGTH,
  REASON_MAX_LENGTH,
  REPLY_MAX_LENGTH,
  TAG_ALLOWANCE,
} from '../constant/team-space.constant';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class SaveSharedSpaceDto {
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  name: string;

  @IsEnum(SharedSpaceAudienceEnum)
  audience: SharedSpaceAudienceEnum;

  @IsBoolean()
  leadersOnly: boolean;

  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  departmentIds: string[];

  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  groupIds: string[];

  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  memberIds: string[];

  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  leaderIds: string[];
}

export class SaveMeetingActionDto {
  @Transform(trim)
  @IsString()
  @Length(1, 300)
  text: string;

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}

export class MeetingActionDoneDto {
  @IsBoolean()
  done: boolean;
}

export class ReactionDto {
  @IsString()
  @MaxLength(16)
  emoji: string;
}

export class PostBodyDto {
  @Transform(trim)
  @IsString()
  @Length(1, POST_MAX_LENGTH + TAG_ALLOWANCE)
  body: string;

  // Community only: an optional title and category.
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(POST_TITLE_MAX_LENGTH)
  title?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;
}

export class RemoveDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(REASON_MAX_LENGTH)
  reason?: string;
}

export class ReportDto {
  @Transform(trim)
  @IsString()
  @Length(1, REASON_MAX_LENGTH)
  reason: string;
}

export class PostCategoryDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;
}

export class LockPostDto {
  @IsBoolean()
  locked: boolean;
}

export class ReplyBodyDto {
  @Transform(trim)
  @IsString()
  @Length(1, REPLY_MAX_LENGTH + TAG_ALLOWANCE)
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

export enum MeetingRepeatEnum {
  NONE = 'NONE',
  WEEKLY = 'WEEKLY',
  FORTNIGHTLY = 'FORTNIGHTLY',
  MONTHLY = 'MONTHLY',
}

export class CreateMeetingDto {
  @IsOptional()
  @IsEnum(MeetingRepeatEnum)
  repeat?: MeetingRepeatEnum;

  // 'YYYY-MM-DD'; no meetings after this date.
  @IsOptional()
  @IsDateString()
  repeatUntil?: string;

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

  // Moving a meeting always tells the team; smaller edits only when the leader asks.
  @IsOptional()
  @IsBoolean()
  notifyTeam?: boolean;

  @IsOptional()
  @IsBoolean()
  stopRepeating?: boolean;

  // For a repeating meeting: also change the meetings after this one.
  @IsOptional()
  @IsBoolean()
  applyToSeries?: boolean;
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

export class ResolveReportDto {
  @IsEnum(ReportOutcomeEnum)
  outcome: ReportOutcomeEnum;
}

export class MuteDto {
  @IsUUID()
  memberId: string;

  @IsIn(MUTE_DAYS)
  days: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(REASON_MAX_LENGTH)
  reason?: string;
}

export class ModeratorDto {
  @IsUUID()
  memberId: string;
}

export class CategoryDto {
  @Transform(trim)
  @IsString()
  @Length(1, 50)
  name: string;
}

export class CategoryOrderDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  ids: string[];
}
