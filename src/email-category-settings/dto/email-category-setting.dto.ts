import { IsBoolean, IsOptional, ValidateIf } from 'class-validator';

export class UpdateEmailCategorySettingDto {
  // At least one switch must be sent.
  @ValidateIf((o: UpdateEmailCategorySettingDto) => o.pushEnabled === undefined)
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;
}

export class EmailCategorySettingResponseDto {
  category: string;
  label: string;
  description: string;
  enabled: boolean;
  // Whether any push notification belongs to this category.
  hasPush: boolean;
  pushEnabled: boolean;
}
