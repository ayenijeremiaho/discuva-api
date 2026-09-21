import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { DepartmentGoalCycle } from './department-goal-cycle.entity';
import { Department } from '../../department/entity/department.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { DepartmentGoalImportJobStatus } from '../enum/department-goal-import-job-status.enum';

@Entity({ name: 'department_goal_import_jobs' })
export class DepartmentGoalImportJob extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => DepartmentGoalCycle, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'cycle_id' })
  cycle: DepartmentGoalCycle;

  @ManyToOne(() => Department, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'department_id' })
  department: Department;

  @Column()
  originalFilename: string;

  @Column({
    type: 'varchar',
    default: DepartmentGoalImportJobStatus.READY_FOR_REVIEW,
  })
  status: DepartmentGoalImportJobStatus;

  @Column({ type: 'int', default: 0 })
  totalRows: number;

  @Column({ type: 'int', default: 0 })
  validRows: number;

  @Column({ type: 'int', default: 0 })
  createdCount: number;

  @Column({ type: 'int', default: 0 })
  failedCommitCount: number;

  @ManyToOne(() => Admin, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: Admin;
}
