import { Expose, Type } from 'class-transformer';
import { WorkerStatusEnum } from '../enums/worker-status.enum';
import { DepartmentCapability } from '../../department/enums/department-capability.enum';

export class DepartmentRefDto {
  @Expose()
  id: string;

  @Expose()
  name: string;

  @Expose()
  capabilities: DepartmentCapability[];
}

export class WorkerProfileDto {
  @Expose()
  id: string;

  @Expose()
  status: WorkerStatusEnum;

  @Expose()
  profession: string | null;

  @Expose()
  yearJoinedWorkforce: Date | null;

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
