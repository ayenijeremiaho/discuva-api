import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  Max,
  Min,
} from 'class-validator';

export class UpdateReminderSettingDto {
  @IsBoolean()
  @IsNotEmpty()
  enabled: boolean;

  @IsArray()
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  @Min(-365, { each: true })
  @Max(365, { each: true })
  thresholds: number[];
}

export class ReminderSettingResponseDto {
  key: string;
  label: string;
  unit: string;
  enabled: boolean;
  thresholds: number[];
}
