import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';
import { SocialPlatform } from '../../social-media/enum/social-media.enum';

export class RegisterSocialPlatformAppDto {
  @IsEnum(SocialPlatform)
  platform: SocialPlatform;

  @IsString()
  @IsNotEmpty()
  clientId: string;

  @IsString()
  @IsNotEmpty()
  clientSecret: string;

  @IsUrl()
  redirectUri: string;

  // One entry per OAuth permission, e.g. 'pages_manage_posts' — not a raw
  // comma/space-joined string. PlatformSocialAppService.upsertApp() checks
  // each value against KNOWN_SOCIAL_SCOPES for this platform (rejecting
  // anything unrecognized and anything missing a required scope) and joins
  // them with that platform's own separator before storing. Still recorded
  // even when configId is set below — it's the declared/expected
  // permission list a Meta Configuration should grant, useful as a record
  // even though it isn't what's literally sent in that case.
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  scopes: string[];

  // Only meaningful for Meta platforms (FACEBOOK/INSTAGRAM) using Facebook
  // Login for Business — see SocialPlatformApp.configId's own comment for
  // why this exists and when it's used instead of `scopes`.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  configId?: string;
}
