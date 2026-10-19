import {
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Member } from '../../member/entity/member.entity';
import { TeamPulseRound } from './team-pulse-round.entity';

// Only that someone answered a round (for "required" follow-up), never what they said.
@Entity({ name: 'team_pulse_participations' })
@Unique(['round', 'member'])
export class TeamPulseParticipation extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => TeamPulseRound, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'round_id' })
  round: TeamPulseRound;

  @Index()
  @ManyToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member: Member;
}
