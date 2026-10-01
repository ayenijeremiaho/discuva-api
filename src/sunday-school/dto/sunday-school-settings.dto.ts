import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateSundaySchoolSettingsDto {
  @IsOptional()
  @IsBoolean()
  oneClassPerMember?: boolean;

  @IsOptional()
  @IsBoolean()
  teachersCanAddMembers?: boolean;

  @IsOptional()
  @IsBoolean()
  teachersCanCheckInFirstTimers?: boolean;
}
