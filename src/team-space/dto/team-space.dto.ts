import { IsBoolean, IsString, Length } from 'class-validator';
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
