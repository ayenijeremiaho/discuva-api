import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Event } from '../../event/entity/event.entity';
import { Member } from '../../member/entity/member.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { FirstTimerSourceEnum } from '../enums/follow-up.enum';
import { FollowUpTask } from './follow-up-task.entity';
import { FirstTimerVisit } from './first-timer-visit.entity';

@Entity({ name: 'first_timers' })
export class FirstTimer extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  firstname: string;

  @Column()
  lastname: string;

  @Column()
  phone: string;

  @Column({ nullable: true })
  email: string | null;

  @Column({ default: FirstTimerSourceEnum.WALK_IN })
  source: FirstTimerSourceEnum;

  @Column({ default: false })
  wantsToJoinChurch: boolean;

  @Column({ nullable: true, type: 'text' })
  enjoyedAboutChurch: string | null;

  @Column({ default: false })
  wantsToJoinWorkforce: boolean;

  @Column({ nullable: true, type: 'text' })
  notes: string | null;

  @ManyToOne(() => Event, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'visited_event_id' })
  visitedEvent: Event | null;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_member_id' })
  createdByMember: Member | null;

  @ManyToOne(() => Admin, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_admin_id' })
  createdByAdmin: Admin | null;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'converted_member_id' })
  convertedMember: Member | null;

  @Column({ name: 'converted_at', nullable: true, type: 'timestamptz' })
  convertedAt: Date | null;

  @Column({ name: 'invite_sent_at', nullable: true, type: 'timestamptz' })
  inviteSentAt: Date | null;

  @OneToOne(() => FollowUpTask, (task) => task.firstTimer)
  followUpTask: FollowUpTask;

  @OneToMany(() => FirstTimerVisit, (v) => v.firstTimer)
  visits: FirstTimerVisit[];

  // Transient — populated explicitly by FollowUpService, not persisted.
  visitCount?: number;

  // Transient — set only when created with no active Follow-Up worker to
  // assign, so the caller can surface a warning instead of blocking.
  assignmentWarning?: string | null;
}
