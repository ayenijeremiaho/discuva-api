import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';
import { LivePlatformEnum } from '../enum/live-platform.enum';

export class AnnounceLiveDto {
  @IsEnum(LivePlatformEnum)
  platform: LivePlatformEnum;

  @IsUrl()
  @IsNotEmpty()
  url: string;

  @IsOptional()
  @IsString()
  title?: string;
}
