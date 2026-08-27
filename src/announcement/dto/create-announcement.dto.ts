import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { AnnouncementAudienceEnum } from '../enum/announcement-audience.enum';

export class CreateAnnouncementDto {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsNotEmpty()
  @IsString()
  body: string;

  @IsOptional()
  @IsEnum(AnnouncementAudienceEnum)
  audience?: AnnouncementAudienceEnum;

  @ValidateIf((o) => o.audience === AnnouncementAudienceEnum.DEPARTMENT)
  @IsUUID()
  departmentId?: string;

  @ValidateIf((o) => o.audience === AnnouncementAudienceEnum.INDIVIDUAL)
  @IsUUID()
  targetMemberId?: string;

  @ValidateIf((o) => o.audience === AnnouncementAudienceEnum.GROUP)
  @IsUUID()
  groupId?: string;

  @ValidateIf((o) => o.audience === AnnouncementAudienceEnum.CLASS)
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsISO8601()
  publishedAt?: string;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  // Requires the SMS_SEND admin permission — checked in the service, not
  // here, since a DTO can't inspect the caller's permission set.
  @IsOptional()
  @IsBoolean()
  sendViaSms?: boolean;

  // Deliberately separate from `body` — required whenever sendViaSms is
  // true, since SMS is billed per segment and the full announcement body
  // is often too long to send as-is.
  @ValidateIf((o) => o.sendViaSms === true)
  @IsNotEmpty()
  @IsString()
  smsBody?: string;
}

export class UpdateAnnouncementDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsEnum(AnnouncementAudienceEnum)
  audience?: AnnouncementAudienceEnum;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  targetMemberId?: string;

  @IsOptional()
  @IsUUID()
  groupId?: string;

  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsISO8601()
  publishedAt?: string;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @IsOptional()
  @IsBoolean()
  sendViaSms?: boolean;

  @ValidateIf((o) => o.sendViaSms === true)
  @IsNotEmpty()
  @IsString()
  smsBody?: string;
}
