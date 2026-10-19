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
import { Member } from '../../member/entity/member.entity';
import { TeamMeeting } from './team-meeting.entity';

export enum RsvpResponseEnum {
  GOING = 'GOING',
  MAYBE = 'MAYBE',
  NOT_GOING = 'NOT_GOING',
}

@Entity({ name: 'team_meeting_rsvps' })
@Unique(['meeting', 'member'])
export class TeamMeetingRsvp extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => TeamMeeting, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'meeting_id' })
  meeting: TeamMeeting;

  @Index()
  @ManyToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  // Null once a leader has recorded attendance for someone who never replied.
  @Column({ type: 'varchar', nullable: true })
  response: RsvpResponseEnum | null;

  @Column({ type: 'boolean', nullable: true })
  attended: boolean | null;
}
