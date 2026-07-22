import { Exclude } from 'class-transformer';
import {
  Column,
  Entity,
  Index,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { MemberRoleEnum } from '../enums/member-role.enum';
import { MemberStatusEnum } from '../enums/member-status.enum';
import { GenderEnum } from '../enums/gender.enum';
import { MaritalStatusEnum } from '../enums/marital-status.enum';
import { WorkerProfile } from './worker-profile.entity';
import { Attendance } from '../../attendance/entity/attendance.entity';
import { ClassEnrollment } from '../../classes/entity/class-enrollment.entity';
import { Pastor } from './pastor.entity';
import { BaseEntity } from '../../utility/entity/base.entity';

@Entity({ name: 'members' })
export class Member extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  firstname: string;

  @Column()
  lastname: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  phoneNumber: string;

  @Exclude()
  @Column({ select: false })
  password: string;

  @Column({ default: false })
  changedPassword: boolean;

  @Exclude()
  @Column({ nullable: true, type: 'varchar', select: false })
  deviceId: string | null;

  @Index()
  @Column({ default: MemberRoleEnum.MEMBER })
  role: MemberRoleEnum;

  @Index()
  @Column({ default: MemberStatusEnum.ACTIVE })
  status: MemberStatusEnum;

  @Column({ nullable: true })
  gender: GenderEnum;

  @Column({ nullable: true, type: 'smallint' })
  birthDay: number | null;

  @Column({ nullable: true, type: 'smallint' })
  birthMonth: number | null;

  @Column({ nullable: true, type: 'smallint' })
  birthYear: number | null;

  @Column({ nullable: true })
  maritalStatus: MaritalStatusEnum;

  @Column({ nullable: true, type: 'date' })
  yearBornAgain: Date;

  @Column({ nullable: true, type: 'date' })
  yearBaptized: Date;

  @Column({ nullable: true, default: false })
  baptizedWithHolyGhost: boolean;

  @Column({ nullable: true, type: 'date' })
  dateJoinedChurch: Date;

  @Column({ nullable: true, type: 'smallint', name: 'birthday_greeted_year' })
  birthdayGreetedYear: number | null;

  @Column({ nullable: true })
  photoUrl: string | null;

  @Exclude()
  @Column({ nullable: true })
  photoPublicId: string | null;

  @OneToOne(() => WorkerProfile, (wp) => wp.member, {
    nullable: true,
    cascade: true,
    eager: false,
  })
  workerProfile: WorkerProfile;

  @OneToMany(() => Attendance, (attendance) => attendance.member)
  attendances: Attendance[];

  @OneToMany(() => ClassEnrollment, (enrollment) => enrollment.member)
  classEnrollments: ClassEnrollment[];

  @OneToOne(() => Pastor, (pastor) => pastor.member, {
    nullable: true,
    eager: false,
  })
  pastor: Pastor;
}
