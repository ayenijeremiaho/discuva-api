import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

export class SubmitPastorFeedbackDto {
  @IsUUID()
  departmentId: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'weekOf must be YYYY-MM-DD' })
  weekOf: string;

  @IsNotEmpty()
  @IsString()
  attendanceNotes: string;

  @IsNotEmpty()
  @IsString()
  highlights: string;

  @IsNotEmpty()
  @IsString()
  challenges: string;

  @IsOptional()
  @IsString()
  prayerRequests?: string;

  @IsOptional()
  @IsString()
  additionalNotes?: string;
}

export class UpdatePastorFeedbackDto {
  @IsOptional()
  @IsString()
  attendanceNotes?: string;

  @IsOptional()
  @IsString()
  highlights?: string;

  @IsOptional()
  @IsString()
  challenges?: string;

  @IsOptional()
  @IsString()
  prayerRequests?: string;

  @IsOptional()
  @IsString()
  additionalNotes?: string;
}

export class RespondToFeedbackDto {
  @IsNotEmpty()
  @IsString()
  response: string;
}
