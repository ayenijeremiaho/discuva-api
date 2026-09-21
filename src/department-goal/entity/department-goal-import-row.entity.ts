import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { DepartmentGoalImportJob } from './department-goal-import-job.entity';
import { DepartmentGoalImportRowStatus } from '../enum/department-goal-import-row-status.enum';
import { DepartmentGoalImportRowData } from '../interface/department-goal-import-row-data.interface';

@Entity({ name: 'department_goal_import_rows' })
export class DepartmentGoalImportRow extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => DepartmentGoalImportJob, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'job_id' })
  job: DepartmentGoalImportJob;

  @Column({ type: 'int' })
  rowNumber: number;

  @Column({ type: 'jsonb' })
  data: DepartmentGoalImportRowData;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  errors: string[];

  @Column({ type: 'varchar', default: DepartmentGoalImportRowStatus.PENDING })
  status: DepartmentGoalImportRowStatus;

  @Column({ type: 'uuid', nullable: true })
  createdGoalId: string | null;

  @Column({ type: 'varchar', nullable: true })
  commitError: string | null;
}
