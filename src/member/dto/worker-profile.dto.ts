import { Expose, Type } from 'class-transformer';
import { WorkerStatusEnum } from '../enums/worker-status.enum';
import { DepartmentKeyEnum } from '../../department/enums/department-key.enum';

export class DepartmentRefDto {
  @Expose()
  id: string;

  @Expose()
  name: string;

  @Expose()
  key: DepartmentKeyEnum | null;
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
