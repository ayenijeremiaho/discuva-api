import { Expose, Type } from 'class-transformer';
import { WorkerStatusEnum } from '../enums/worker-status.enum';

export class DepartmentRefDto {
  @Expose()
  id: string;

  @Expose()
  name: string;

  // Free-form — matches Department.key (see its doc comment). Not validated
  // against DepartmentKeyEnum, which is only a preset-suggestion list.
  @Expose()
  key: string | null;
}

export class WorkerProfileDto {
  @Expose()
  id: string;

  @Expose()
  status: WorkerStatusEnum;

  @Expose()
  profession: string;

  @Expose()
  yearJoinedWorkforce: Date;

  @Expose()
  completedSOD: boolean;

  @Expose()
  completedBibleCollege: boolean;

  @Expose()
  isTrainee: boolean;

  @Expose()
  @Type(() => DepartmentRefDto)
  department: DepartmentRefDto;

  @Expose()
  @Type(() => DepartmentRefDto)
  secondaryDepartment: DepartmentRefDto | null;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;
}
