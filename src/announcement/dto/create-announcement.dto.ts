import {
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

  @IsOptional()
  @IsISO8601()
  publishedAt?: string;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
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
  @IsISO8601()
  publishedAt?: string;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
