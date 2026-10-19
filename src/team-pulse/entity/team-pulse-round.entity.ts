import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { TeamPulse } from './team-pulse.entity';

export interface RatingTally {
  count: number;
  sum: number;
  // How many chose 1..5, in that order.
  spread: number[];
}

// One sending of a pulse. Answers live here only as totals and unsigned comments, so none can be traced to a person.
@Entity({ name: 'team_pulse_rounds' })
@Index(['pulse', 'opensAt'])
export class TeamPulseRound extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => TeamPulse, (pulse) => pulse.rounds, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'pulse_id' })
  pulse: TeamPulse;

  @Column({ type: 'timestamptz' })
  opensAt: Date;

  @Index()
  @Column({ type: 'timestamptz' })
  closesAt: Date;

  @Column({ type: 'int', default: 0 })
  invitedCount: number;

  @Column({ type: 'int', default: 0 })
  responseCount: number;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  ratings: Record<string, RatingTally>;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  comments: Record<string, string[]>;

  @Column({ type: 'timestamptz', nullable: true })
  reminderSentAt: Date | null;
}
