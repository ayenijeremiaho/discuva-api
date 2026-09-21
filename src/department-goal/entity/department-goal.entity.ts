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
import { Member } from '../../member/entity/member.entity';

@Entity({ name: 'department_goals' })
export class DepartmentGoal extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => DepartmentGoalCycle, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'cycle_id' })
  cycle: DepartmentGoalCycle;

  // RESTRICT, not CASCADE — this is a compliance record; department
  // deletion should be blocked by existing goal history rather than
  // silently erasing it (department deletion is already blocked elsewhere
  // in this codebase whenever workers are still assigned, for the same
  // reason).
  @Index()
  @ManyToOne(() => Department, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'department_id' })
  department: Department;

  // Displayed as "KPI" (Key Performance Indicator) in both admin/member
  // UIs — kept named `title` internally (no migration needed for a
  // display-only relabel).
  @Column()
  title: string;

  // Displayed as "KPI Description" — previously informally doubled as
  // "the measurable target" in discuva-member's placeholder copy; that
  // role now belongs to timelineToAchieve below.
  @Column({ type: 'text', nullable: true })
  description: string | null;

  // "Timeline to Achieve Target" — freeform text (e.g. "Q3 2026", "by end
  // of cycle"), not a strict date: matches how the source KPI table this
  // was modeled on reads, and avoids implying the same hard-deadline
  // enforcement DepartmentGoalCycle.graceDeadline/endDate already carry
  // at the cycle level. Purely descriptive, never validated/enforced.
  @Column({ name: 'timeline_to_achieve', type: 'text', nullable: true })
  timelineToAchieve: string | null;

  // Frozen the instant either rating is set — enforced in
  // DepartmentGoalService, not a DB constraint (see assertNotFrozen).
  @Column({ name: 'church_rating', type: 'smallint', nullable: true })
  churchRating: number | null;

  @Column({ name: 'church_rating_reason', type: 'text', nullable: true })
  churchRatingReason: string | null;

  @Column({ name: 'church_rated_at', type: 'timestamptz', nullable: true })
  churchRatedAt: Date | null;

  @ManyToOne(() => Admin, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'church_rated_by_admin_id' })
  churchRatedByAdmin: Admin | null;

  @Column({ name: 'self_rating', type: 'smallint', nullable: true })
  selfRating: number | null;

  @Column({ name: 'self_rating_reason', type: 'text', nullable: true })
  selfRatingReason: string | null;

  @Column({ name: 'self_rated_at', type: 'timestamptz', nullable: true })
  selfRatedAt: Date | null;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'self_rated_by_member_id' })
  selfRatedByMember: Member | null;

  // Set when an admin bulk-uploads this goal on behalf of a HOD (see
  // DepartmentGoalImportService); null for goals the HOD entered directly.
  @ManyToOne(() => Admin, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_admin_id' })
  createdByAdmin: Admin | null;
}
