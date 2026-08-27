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

  // Email always sends for reminder types that support it — this only
  // controls whether SMS *additionally* goes out to enrollees with a phone
  // number on file. Required like the fields above since upsert() replaces
  // the whole stored value rather than merging a partial patch.
  @IsBoolean()
  @IsNotEmpty()
  smsEnabled: boolean;
}

export class ReminderSettingResponseDto {
  key: string;
  label: string;
  unit: string;
  enabled: boolean;
  thresholds: number[];
  smsEnabled: boolean;
}
