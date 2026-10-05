import { IsBoolean, IsIn, IsOptional, ValidateIf } from 'class-validator';

// How a category reaches people. PUSH_FIRST emails only those who can't get the push.
export const DELIVERY_MODES = [
  'EMAIL_AND_PUSH',
  'PUSH_FIRST',
  'PUSH_ONLY',
  'EMAIL_ONLY',
  'OFF',
] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

export class UpdateEmailCategorySettingDto {
  // Either a delivery mode, or at least one of the raw switches.
  @IsOptional()
  @IsIn(DELIVERY_MODES)
  mode?: DeliveryMode;

  @ValidateIf(
    (o: UpdateEmailCategorySettingDto) =>
      o.mode === undefined &&
      o.pushEnabled === undefined &&
      o.pushFirst === undefined,
  )
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  pushFirst?: boolean;
}

export class EmailCategorySettingResponseDto {
  category: string;
  label: string;
  description: string;
  enabled: boolean;
  // Whether any push notification belongs to this category.
  hasPush: boolean;
  pushEnabled: boolean;
  pushFirst: boolean;
  mode: DeliveryMode;
}
