import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { ApprovalLevelConfig } from '../interface/approval-level.interface';

// One cycle is global/church-wide — every department drafts goals inside the
// same shared window, not per-department cycles (inferred from "every
// department's HOD sets goals... during a short opening window" in the
// source doc). Dates are plain 'yyyy-MM-dd' strings compared via
// DateService.today(), matching ChurchCalendar/PledgeCampaign — never
// timestamptz, since only the calendar day matters here.
@Entity({ name: 'department_goal_cycles' })
export class DepartmentGoalCycle extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  // The opening window's close boundary — movable anytime by the church,
  // even mid-window, without touching startDate/endDate.
  @Column({ name: 'grace_deadline', type: 'date' })
  graceDeadline: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate: string;

  // Deactivating a cycle (cancel/close early) is distinct from it simply
  // running past its dates — see GoalCycleStage.INACTIVE.
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  // Optional, up to 3 levels, in order. null/empty = no approval gate for
  // this cycle at all — every department behaves exactly as before this
  // feature existed. See DepartmentGoalApprovalService for how this drives
  // per-department blocking (never the cycle's own OPENING/IN_PROGRESS/
  // REVIEWED stage, which stays a pure function of dates).
  @Column({ name: 'approval_chain', type: 'jsonb', nullable: true })
  approvalChain: ApprovalLevelConfig[] | null;
}
