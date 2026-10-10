import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { WorkerStatusEnum } from '../enums/worker-status.enum';

// A blank form field means "leave unchanged", not an invalid value.
const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' ? undefined : value;

export class UpdateWorkerProfileDto {
  @Transform(emptyToUndefined)
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

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  profession?: string;

  @Transform(emptyToUndefined)
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
