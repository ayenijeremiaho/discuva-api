import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

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

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  teacherMarkingDays?: number;
}
