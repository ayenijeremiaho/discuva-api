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
import { BaseEntity } from '../../utility/entity/base.entity';
import { FirstTimer } from './first-timer.entity';
import { Member } from '../../member/entity/member.entity';
import { Event } from '../../event/entity/event.entity';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import {
  FollowUpOutcomeEnum,
  FollowUpTaskStatusEnum,
  FollowUpTaskTypeEnum,
} from '../enums/follow-up.enum';
import { FollowUpNote } from './follow-up-note.entity';

@Entity({ name: 'follow_up_tasks' })
export class FollowUpTask extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ default: FollowUpTaskTypeEnum.FIRST_TIMER })
  type: FollowUpTaskTypeEnum;

  @Column({ default: FollowUpTaskStatusEnum.PENDING })
  status: FollowUpTaskStatusEnum;

  @OneToOne(() => FirstTimer, (ft) => ft.followUpTask, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'first_timer_id' })
  firstTimer: FirstTimer | null;

  @Index('IDX_follow_up_tasks_member_id')
  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'member_id' })
  member: Member | null;

  @Index('IDX_follow_up_tasks_event_id')
  @ManyToOne(() => Event, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'event_id' })
  event: Event | null;

  @ManyToOne(() => WorkerProfile, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'assigned_to_id' })
  assignedTo: WorkerProfile;

  @Column({ nullable: true })
  outcome: FollowUpOutcomeEnum | null;

  @Column({ nullable: true, type: 'text' })
  outcomeNotes: string | null;

  @Column({ nullable: true, type: 'date' })
  dueDate: Date | null;

  @OneToMany(() => FollowUpNote, (note) => note.task)
  notes: FollowUpNote[];

  @Column({
    name: 'last_activity_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  lastActivityAt: Date;
}
