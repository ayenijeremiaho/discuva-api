import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  TeamPulseFrequencyEnum,
  TeamPulseQuestionKindEnum,
} from '../enum/team-pulse.enum';
import { MAX_QUESTIONS } from '../constant/team-pulse.constant';

export class TeamPulseQuestionDto {
  @IsEnum(TeamPulseQuestionKindEnum)
  kind: TeamPulseQuestionKindEnum;

  @IsString()
  @Length(3, 160)
  text: string;
}

export class CreateTeamPulseDto {
  @IsUUID()
  departmentId: string;

  @IsString()
  @Length(2, 80)
  title: string;

  @ValidateNested({ each: true })
  @Type(() => TeamPulseQuestionDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_QUESTIONS)
  questions: TeamPulseQuestionDto[];

  @IsEnum(TeamPulseFrequencyEnum)
  frequency: TeamPulseFrequencyEnum;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(14)
  responseWindowDays?: number;

  @IsOptional()
  @IsBoolean()
  required?: boolean;
}

export class UpdateTeamPulseDto {
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  required?: boolean;
}

export class RespondTeamPulseDto {
  // Question id -> 1..5 for a rating, text for a comment. Unanswered questions are left out.
  @IsObject()
  answers: Record<string, number | string>;
}
