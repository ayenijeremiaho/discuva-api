import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateAnniversarySettingsDto {
  @IsOptional()
  @IsBoolean()
  postEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}

export interface AnniversarySettings {
  postEnabled: boolean;
  title: string;
  message: string;
}

export interface AnniversaryCelebrant {
  id: string;
  firstname: string;
  lastname: string;
  email: string;
  phoneNumber: string | null;
  photoUrl: string | null;
  dateJoinedChurch: string;
  years: number;
  daysAway: number;
}
