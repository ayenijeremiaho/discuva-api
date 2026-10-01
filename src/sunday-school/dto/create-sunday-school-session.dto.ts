import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateSundaySchoolSessionDto {
  @IsUUID('4')
  classId: string;

  @IsDateString()
  sessionDate: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsOptional()
  @IsUrl()
  documentUrl?: string;
}

export class OpenSelfMarkDto {
  @IsInt()
  @Min(5)
  @Max(480)
  closesInMinutes: number;
}

// Empty string or null clears notes / documentUrl.
export class UpdateSundaySchoolSessionDto {
  @IsOptional()
  @IsDateString()
  sessionDate?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  notes?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsUrl()
  documentUrl?: string | null;
}

export class CreateSundaySchoolSessionSeriesDto {
  @IsUUID('4')
  classId: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  everyWeeks?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}
