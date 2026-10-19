import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Department } from '../../department/entity/department.entity';
import { Member } from '../../member/entity/member.entity';
import {
  TeamPulseFrequencyEnum,
  TeamPulseQuestionKindEnum,
} from '../enum/team-pulse.enum';
import { TeamPulseRound } from './team-pulse-round.entity';

export interface TeamPulseQuestion {
  id: string;
  kind: TeamPulseQuestionKindEnum;
  text: string;
}

// A recurring check-in a department lead sends their team, about how the team is doing (never about one person).
@Entity({ name: 'team_pulses' })
export class TeamPulse extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => Department, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'department_id' })
  department: Department;

  @Column()
  title: string;

  @Column({ type: 'jsonb' })
  questions: TeamPulseQuestion[];

  @Column({ type: 'varchar', default: TeamPulseFrequencyEnum.ONCE })
  frequency: TeamPulseFrequencyEnum;

  @Column({ type: 'smallint', default: 3 })
  responseWindowDays: number;

  @Column({ default: false })
  required: boolean;

  @Column({ default: true })
  active: boolean;

  // When the next round opens; null for one-off pulses once opened, or when stopped.
  @Column({ type: 'timestamptz', nullable: true })
  nextOpenAt: Date | null;

  @ManyToOne(() => Member, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: Member | null;

  @OneToMany(() => TeamPulseRound, (round) => round.pulse)
  rounds: TeamPulseRound[];
}
