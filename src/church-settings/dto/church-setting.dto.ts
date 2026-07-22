import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateChurchSettingDto {
  @IsBoolean()
  @IsNotEmpty()
  enabled: boolean;

  @IsOptional()
  @IsString()
  displayName?: string;
}

export class ChurchSettingResponseDto {
  key: string;
  moduleName: string;
  enabled: boolean;
  required: boolean;
  displayName?: string;
}
