import { IsEnum, IsNotEmpty, IsString, IsUrl } from 'class-validator';
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

  @IsString()
  @IsNotEmpty()
  scopes: string;
}
