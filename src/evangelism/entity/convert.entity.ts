import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Member } from '../../member/entity/member.entity';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { BaseEntity } from '../../utility/entity/base.entity';
import { ConvertStatusEnum } from '../enum/convert-status.enum';
import { Outreach } from './outreach.entity';
import { FirstTimer } from '../../follow-up/entity/first-timer.entity';

@Entity({ name: 'converts' })
export class Convert extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Index()
  @Column({ nullable: true })
  phone: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Index()
  @Column({
    type: 'character varying',
    default: ConvertStatusEnum.UNSAVED,
  })
  status: ConvertStatusEnum;

  // Nullable + SET NULL — a deactivated worker's onboarding history survives.
  // Name is snapshotted below for the same reason.
  @Index()
  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'onboarded_by' })
  onboardedBy: Member | null;

  @Column({ name: 'onboarded_by_name' })
  onboardedByName: string;

  @Index()
  @ManyToOne(() => Outreach, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'outreach_id' })
  outreach: Outreach | null;

  // WorkerProfile, not Member — mirrors FollowUpTask.assignedTo, so
  // reassignment can reuse the same "must be in the target department"
  // validation idiom as the Follow-Up module.
  @Index()
  @ManyToOne(() => WorkerProfile, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_to' })
  assignedTo: WorkerProfile | null;

  // Set once this convert becomes an actual church Member — mirrors
  // first_timers.converted_member_id/converted_at. Indexed — getTeamConverts()
  // joins this relation on every page load to compute the "already linked"
  // exclusion for the overdue flag.
  @Index()
  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'member_id' })
  member: Member | null;

  @Column({ name: 'linked_at', type: 'timestamptz', nullable: true })
  linkedAt: Date | null;

  // Set when Follow-Up confirms this convert visited church; Follow-Up then owns the follow-up.
  @Index()
  @ManyToOne(() => FirstTimer, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'first_timer_id' })
  firstTimer: FirstTimer | null;

  @Column({
    name: 'first_timer_linked_at',
    type: 'timestamptz',
    nullable: true,
  })
  firstTimerLinkedAt: Date | null;

  // Denormalized for the follow-up staleness/overdue indicator — updated
  // whenever a new ConvertFollowUpLog is added.
  @Column({ name: 'last_contacted_at', type: 'timestamptz', nullable: true })
  lastContactedAt: Date | null;
}
