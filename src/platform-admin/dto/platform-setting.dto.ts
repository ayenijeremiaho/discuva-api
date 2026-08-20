import { IsInt, IsNotEmpty, Max, Min } from 'class-validator';

// Loose sanity bound only — the real, per-key min/max (KNOWN_PLATFORM_SETTINGS)
// is enforced in PlatformSettingsService.upsert(), since class-validator
// decorators can't vary by which :key the request targets.
export class UpdatePlatformSettingDto {
  @IsInt()
  @IsNotEmpty()
  @Min(0)
  @Max(100000)
  value: number;
}

export class PlatformSettingResponseDto {
  key: string;
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  type: 'number' | 'boolean';
}
