import { Expose, Transform, Type } from 'class-transformer';
import { MemberRoleEnum } from '../enums/member-role.enum';
import { MemberStatusEnum } from '../enums/member-status.enum';
import { GenderEnum } from '../enums/gender.enum';
import { MaritalStatusEnum } from '../enums/marital-status.enum';
import { DepartmentCapability } from '../../department/enums/department-capability.enum';
import { WorkerProfileDto } from './worker-profile.dto';

export class ClergyTitleRefDto {
  @Expose()
  id: string;

  @Expose()
  name: string;
}

export class MemberClergyDto {
  @Expose()
  @Type(() => ClergyTitleRefDto)
  title: ClergyTitleRefDto;

  @Expose()
  canReviewFeedback: boolean;
}

export class MemberDto {
  @Expose()
  id: string;

  @Expose()
  firstname: string;

  @Expose()
  lastname: string;

  @Expose()
  email: string;

  @Expose()
  phoneNumber: string;

  @Expose()
  changedPassword: boolean;

  @Expose()
  role: MemberRoleEnum;

  @Expose()
  status: MemberStatusEnum;

  @Expose()
  gender: GenderEnum;

  @Expose()
  birthDay: number | null;

  @Expose()
  birthMonth: number | null;

  @Expose()
  birthYear: number | null;

  @Expose()
  maritalStatus: MaritalStatusEnum;

  @Expose()
  yearBornAgain: Date;

  @Expose()
  yearBaptized: Date;

  @Expose()
  baptizedWithHolyGhost: boolean;

  @Expose()
  dateJoinedChurch: Date;

  @Expose()
  photoUrl: string | null;

  @Expose()
  @Type(() => WorkerProfileDto)
  workerProfile: WorkerProfileDto;

  @Expose()
  @Type(() => MemberClergyDto)
  @Transform(({ obj }) =>
    obj.clergy
      ? {
          title: obj.clergy.title,
          canReviewFeedback: obj.clergy.canReviewFeedback,
        }
      : null,
  )
  clergy: MemberClergyDto | null;

  @Expose()
  @Transform(({ obj }) => {
    const primary: DepartmentCapability[] =
      obj.workerProfile?.department?.capabilities ?? [];
    const secondary: DepartmentCapability[] =
      obj.workerProfile?.secondaryDepartment?.capabilities ?? [];
    return Array.from(new Set([...primary, ...secondary]));
  })
  capabilities: DepartmentCapability[];

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;
}
