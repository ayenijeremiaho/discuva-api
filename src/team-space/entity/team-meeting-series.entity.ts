import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Member } from '../../member/entity/member.entity';
import { TeamSpace } from './team-space.entity';
import { MeetingFrequencyEnum } from '../../small-group/enum/meeting-frequency.enum';
import { MeetingSchedule } from '../../small-group/util/meeting-schedule';

// A meeting that repeats. Only the next meeting exists at a time; when it starts, the next is added with the same details and link.
@Entity({ name: 'team_meeting_series' })
export class TeamMeetingSeries extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => TeamSpace, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'space_id' })
  space: TeamSpace;

  @Column()
  title: string;

  @Column({ type: 'varchar', nullable: true })
  location: string | null;

  @Column({ type: 'varchar', nullable: true })
  onlineLink: string | null;

  @Column({ type: 'text', nullable: true })
  agenda: string | null;

  @Column({ type: 'varchar' })
  frequency: MeetingFrequencyEnum;

  @Column({ type: 'smallint' })
  weekday: number;

  @Column({ type: 'varchar', length: 5 })
  startTime: string;

  @Column({ type: 'varchar', length: 5, nullable: true })
  endTime: string | null;

  @Column({ type: 'smallint', default: 1 })
  intervalWeeks: number;

  @Column({ type: 'smallint', nullable: true })
  weekOfMonth: number | null;

  @Column({ type: 'date' })
  startsOn: string;

  @Column({ type: 'date', nullable: true })
  endsOn: string | null;

  @Column({ default: true })
  active: boolean;

  @Index()
  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: Member | null;
}

export function seriesSchedule(s: TeamMeetingSeries): MeetingSchedule {
  return {
    frequency: s.frequency,
    weekday: s.weekday,
    startTime: s.startTime,
    endTime: s.endTime,
    intervalWeeks: s.intervalWeeks,
    weekOfMonth: s.weekOfMonth,
    startsOn: s.startsOn,
  };
}
