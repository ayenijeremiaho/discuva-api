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
import {
  BibleGameModeEnum,
  BibleGameRoundStatusEnum,
} from '../enum/bible-game-mode.enum';
import type { Question } from '../engine/questions';

export interface RoundAnswer {
  choice: number | null;
  correct: boolean;
  points: number;
  seconds: number;
}

@Entity({ name: 'bible_game_rounds' })
@Index('IDX_bible_game_rounds_member_created', ['memberId', 'createdAt'])
export class BibleGameRound extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member?: Member;

  @Column({ name: 'member_id', type: 'uuid' })
  memberId: string;

  @Column({ type: 'varchar' })
  mode: BibleGameModeEnum;

  @Column({ type: 'int', nullable: true })
  level: number | null;

  // The day (daily) or week (weekly) a round belongs to; one per member.
  @Column({ name: 'period_key', type: 'varchar', nullable: true })
  periodKey: string | null;

  @Column({ name: 'time_limit', type: 'int' })
  timeLimit: number;

  // Includes the right answers: never sent to the member as-is.
  @Column({ type: 'jsonb' })
  questions: Question[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  answers: RoundAnswer[];

  @Column({ name: 'current_index', type: 'int', default: 0 })
  currentIndex: number;

  // When the current question was shown; the time limit is measured from here.
  @Column({ name: 'asked_at', type: 'timestamptz', nullable: true })
  askedAt: Date | null;

  @Column({ type: 'int', default: 0 })
  correct: number;

  @Column({ type: 'int', default: 0 })
  points: number;

  // What actually went on the scoreboard (a replay only adds its improvement).
  @Column({ type: 'int', default: 0 })
  awarded: number;

  @Column({ type: 'varchar', default: BibleGameRoundStatusEnum.ACTIVE })
  status: BibleGameRoundStatusEnum;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}
