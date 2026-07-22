import { Expose, Transform, Type } from 'class-transformer';
import { MemberRoleEnum } from '../enums/member-role.enum';
import { MemberStatusEnum } from '../enums/member-status.enum';
import { GenderEnum } from '../enums/gender.enum';
import { MaritalStatusEnum } from '../enums/marital-status.enum';
import { PastorTypeEnum } from '../enums/pastor-type.enum';
import { WorkerProfileDto } from './worker-profile.dto';

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
  @Transform(({ obj }) => obj.pastor?.type ?? null)
  pastorType: PastorTypeEnum | null;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;
}
