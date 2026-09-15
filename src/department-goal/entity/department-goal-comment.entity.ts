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

// Mirrors FollowUpNote's shape. Two kinds of row share this table: a general
// comment (approvalLevel/decision both null, always postable, independent of
// any approval chain) and a decision-echo written by
// DepartmentGoalApprovalService.decide() (approvalLevel/decision set), so the
// HOD sees one unified, chronological feed instead of two separate views.
@Entity({ name: 'department_goal_comments' })
export class DepartmentGoalComment extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => DepartmentGoalCycle, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'cycle_id' })
  cycle: DepartmentGoalCycle;

  @Index()
  @ManyToOne(() => Department, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'department_id' })
  department: Department;

  @ManyToOne(() => Admin, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'posted_by_admin_id' })
  postedByAdmin: Admin | null;

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'approval_level', type: 'smallint', nullable: true })
  approvalLevel: number | null;

  @Column({ type: 'varchar', nullable: true })
  decision: 'APPROVED' | 'CHANGES_REQUESTED' | null;
}
