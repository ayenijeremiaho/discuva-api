import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SocialPlacement, SocialPlatform } from '../enum/social-media.enum';

export class CreateSocialAccountDto {
  @IsEnum(SocialPlatform)
  platform: SocialPlatform;

  @IsNotEmpty()
  @IsString()
  displayName: string;
}

export class SocialPostTargetDto {
  @IsUUID('4')
  accountId: string;

  @IsEnum(SocialPlacement)
  placement: SocialPlacement;
}

export class CreateSocialPostDto {
  @IsNotEmpty()
  @IsString()
  content: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SocialPostTargetDto)
  targets: SocialPostTargetDto[];
}

// A separate action from create() — mirrors publish() being its own
// endpoint rather than a create-time flag, so media/targets can be
// attached to a draft first, then scheduled once ready.
export class ScheduleSocialPostDto {
  @IsDateString()
  scheduledFor: string;
}
