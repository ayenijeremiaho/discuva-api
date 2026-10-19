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
import { TeamPoll } from './team-poll.entity';

@Entity({ name: 'team_poll_votes' })
@Unique(['poll', 'member'])
export class TeamPollVote extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => TeamPoll, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'poll_id' })
  poll: TeamPoll;

  @Index()
  @ManyToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Column({ type: 'varchar', array: true })
  optionIds: string[];
}
