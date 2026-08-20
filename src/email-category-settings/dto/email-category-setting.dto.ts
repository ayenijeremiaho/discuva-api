import { IsBoolean, IsNotEmpty } from 'class-validator';

export class UpdateEmailCategorySettingDto {
  @IsBoolean()
  @IsNotEmpty()
  enabled: boolean;
}

export class EmailCategorySettingResponseDto {
  category: string;
  label: string;
  description: string;
  enabled: boolean;
}
