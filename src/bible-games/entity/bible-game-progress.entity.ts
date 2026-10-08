import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Member } from '../../member/entity/member.entity';

export type LevelBests = Record<string, { correct: number; points: number }>;

@Entity({ name: 'bible_game_progress' })
export class BibleGameProgress extends BaseEntity {
  @PrimaryColumn({ name: 'member_id', type: 'uuid' })
  memberId: string;

  @OneToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member?: Member;

  @Column({ name: 'highest_passed', type: 'int', default: 0 })
  highestPassed: number;

  // Best result per level; replays only earn the points they add on top of it.
  @Column({ type: 'jsonb', default: () => "'{}'" })
  best: LevelBests;

  @Column({ name: 'daily_streak', type: 'int', default: 0 })
  dailyStreak: number;

  @Column({ name: 'last_daily_date', type: 'date', nullable: true })
  lastDailyDate: string | null;

  @Column({ name: 'perfect_rounds', type: 'int', default: 0 })
  perfectRounds: number;

  // All-time points, kept in step with the points ledger.
  @Column({ name: 'points_total', type: 'int', default: 0 })
  pointsTotal: number;
}
