import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApprovalLevelDto } from './department-goal-approval.dto';

export class CreateGoalCycleDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  graceDeadline: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ApprovalLevelDto)
  approvalChain?: ApprovalLevelDto[] | null;
}

export class UpdateGoalCycleDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  // The one field expected to move after creation — the church can push
  // the opening window's close date out anytime.
  @IsOptional()
  @IsDateString()
  graceDeadline?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ApprovalLevelDto)
  approvalChain?: ApprovalLevelDto[] | null;
}

export class CreateGoalDto {
  // Displayed as "KPI" in both admin/member UIs.
  @IsString()
  @IsNotEmpty()
  title: string;

  // Displayed as "KPI Description".
  @IsOptional()
  @IsString()
  description?: string;

  // "Timeline to Achieve Target" — freeform text, never validated as a
  // date (see DepartmentGoal.timelineToAchieve).
  @IsOptional()
  @IsString()
  timelineToAchieve?: string;
}

export class UpdateGoalDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  timelineToAchieve?: string;
}

export class SubmitRatingDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsString()
  @IsNotEmpty()
  reason: string;
}
