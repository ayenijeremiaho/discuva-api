import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Member } from './member.entity';
import { WorkerStatusEnum } from '../enums/worker-status.enum';
import { Department } from '../../department/entity/department.entity';
import { RequestLeave } from '../../request-leave/enitity/request-leave.entity';
import { BaseEntity } from '../../utility/entity/base.entity';

@Entity({ name: 'worker_profiles' })
export class WorkerProfile extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Member, (member) => member.workerProfile, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Index()
  @ManyToOne(() => Department, (department) => department.id, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'department_id' })
  department: Department;

  /** Optional secondary department. Access-controlled modules allow entry when this matches. */
  @Index()
  @ManyToOne(() => Department, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'secondary_department_id' })
  secondaryDepartment: Department | null;

  @Index()
  @Column({ default: WorkerStatusEnum.ACTIVE })
  status: WorkerStatusEnum;

  @Column({ nullable: true })
  profession: string;

  @Column({ nullable: true, type: 'date' })
  yearJoinedWorkforce: Date;

  @Column({ default: false })
  completedSOD: boolean;

  @Column({ default: false })
  completedBibleCollege: boolean;

  @Index()
  @Column({ default: false })
  isTrainee: boolean;

  @OneToMany(() => RequestLeave, (leave) => leave.workerProfile)
  leaveRequests: RequestLeave[];
}
