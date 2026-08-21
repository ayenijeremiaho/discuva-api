import { IsBoolean } from 'class-validator';

export class SetSocialPlatformAppActiveDto {
  @IsBoolean()
  isActive: boolean;
}
