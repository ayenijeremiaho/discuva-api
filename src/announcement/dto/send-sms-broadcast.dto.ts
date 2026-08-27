import {
  IsEnum,
  IsNotEmpty,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { AnnouncementAudienceEnum } from '../enum/announcement-audience.enum';

export class SendSmsBroadcastDto {
  @IsEnum(AnnouncementAudienceEnum)
  audience: AnnouncementAudienceEnum;

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

  @IsNotEmpty()
  @IsString()
  message: string;
}
