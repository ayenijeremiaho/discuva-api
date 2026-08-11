import { IsInt, IsNotEmpty, Max, Min } from 'class-validator';

export class UpdatePlatformSettingDto {
  @IsInt()
  @IsNotEmpty()
  @Min(0)
  @Max(365)
  value: number;
}

export class PlatformSettingResponseDto {
  key: string;
  label: string;
  unit: string;
  value: number;
}
