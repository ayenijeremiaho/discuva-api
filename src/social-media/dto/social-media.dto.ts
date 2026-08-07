import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
} from 'class-validator';
import { SocialPlatform } from '../enum/social-media.enum';

export class CreateSocialAccountDto {
  @IsEnum(SocialPlatform)
  platform: SocialPlatform;

  @IsNotEmpty()
  @IsString()
  displayName: string;
}

export class CreateSocialPostDto {
  @IsNotEmpty()
  @IsString()
  content: string;

  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  targetAccountIds: string[];
}
