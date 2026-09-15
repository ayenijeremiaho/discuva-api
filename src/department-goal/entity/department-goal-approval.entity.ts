import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { DepartmentGoalCycle } from './department-goal-cycle.entity';
import { Department } from '../../department/entity/department.entity';
import { DepartmentGoalApprovalStatus } from '../enum/department-goal-approval-status.enum';
import { ApprovalLevelConfig } from '../interface/approval-level.interface';

// One row per (cycle, department), created lazily the moment that
// department's HOD writes their first goal in a cycle that has an
// approvalChain configured — see DepartmentGoalApprovalService.getOrCreateApproval
// for why eager creation across every department isn't done instead.
@Entity({ name: 'department_goal_approvals' })
@Unique(['cycle', 'department'])
export class DepartmentGoalApproval extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

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

  // Which level of the cycle's approvalChain is currently awaiting a
  // decision. Never decremented — a REQUEST_CHANGES keeps the same level
  // active (the same approver re-reviews the HOD's revision) rather than
  // sending it back to level 1.
  @Column({ name: 'current_level', type: 'smallint', default: 1 })
  currentLevel: number;

  @Column({
    type: 'varchar',
    default: DepartmentGoalApprovalStatus.PENDING,
  })
  status: DepartmentGoalApprovalStatus;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  // Sparse — only the levels this SPECIFIC department has overridden, not
  // a full parallel chain. Every other level still resolves from the
  // cycle's shared approvalChain. Exists for the case where a cycle-wide
  // approver happens to also be THIS department's own HOD (self-review is
  // always blocked) — rather than reassigning that level for every
  // department in the cycle, an admin can swap just this one department's
  // approver for that level.
  @Column({ name: 'level_overrides', type: 'jsonb', nullable: true })
  levelOverrides: ApprovalLevelConfig[] | null;
}
