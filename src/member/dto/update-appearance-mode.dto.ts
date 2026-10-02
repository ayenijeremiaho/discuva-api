import { IsEnum } from 'class-validator';
import { AppearanceMode } from '../enums/appearance-mode.enum';

export class UpdateAppearanceModeDto {
  @IsEnum(AppearanceMode)
  appearanceMode: AppearanceMode;
}
