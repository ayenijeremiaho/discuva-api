import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { AppearanceMode } from '../enums/appearance-mode.enum';

export class UpdateAppearanceModeDto {
  @IsOptional()
  @IsEnum(AppearanceMode)
  appearanceMode?: AppearanceMode;

  @IsOptional()
  @IsBoolean()
  useChurchTheme?: boolean;
}
