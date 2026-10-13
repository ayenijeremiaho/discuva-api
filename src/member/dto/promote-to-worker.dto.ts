import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

export class PromoteToWorkerDto {
  @IsUUID()
  departmentId: string;

  @IsOptional()
  @IsString()
  profession?: string;

  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'yearJoinedWorkforce must be a 4-digit year' })
  yearJoinedWorkforce?: string;

  @IsOptional()
  @IsBoolean()
  isTrainee?: boolean;
}
