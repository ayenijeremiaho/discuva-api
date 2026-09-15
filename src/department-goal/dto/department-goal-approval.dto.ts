import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class ApprovalLevelDto {
  @IsInt()
  @Min(1)
  @Max(3)
  level: number;

  @IsUUID()
  adminId: string;
}

export class ApprovalDecisionDto {
  @IsIn(['APPROVE', 'REQUEST_CHANGES'])
  decision: 'APPROVE' | 'REQUEST_CHANGES';

  @IsOptional()
  @IsString()
  comment?: string;
}

export class AddDepartmentGoalCommentDto {
  @IsString()
  @IsNotEmpty()
  content: string;
}

export class SetApprovalLevelOverrideDto {
  @IsInt()
  @Min(1)
  @Max(3)
  level: number;

  // null clears an existing override for this level, reverting the
  // department back to the cycle's default chain for that level.
  @IsOptional()
  @IsUUID()
  adminId?: string | null;
}
