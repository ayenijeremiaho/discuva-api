import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';
import { WorkerStatusEnum } from '../enums/worker-status.enum';

export class UpdateWorkerProfileDto {
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  /** UUID of the secondary department, or null to remove the secondary assignment. */
  @IsOptional()
  @IsUUID()
  secondaryDepartmentId?: string | null;

  @IsOptional()
  @IsEnum(WorkerStatusEnum)
  status?: WorkerStatusEnum;

  @IsOptional()
  @IsString()
  profession?: string;

  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'yearJoinedWorkforce must be a 4-digit year' })
  yearJoinedWorkforce?: string;

  @IsOptional()
  @IsBoolean()
  completedSOD?: boolean;

  @IsOptional()
  @IsBoolean()
  completedBibleCollege?: boolean;

  @IsOptional()
  @IsBoolean()
  isTrainee?: boolean;
}
