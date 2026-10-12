import {
  Column,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Member } from '../../member/entity/member.entity';

export type LevelBests = Record<string, { correct: number; points: number }>;

@Entity({ name: 'bible_game_progress' })
@Index('IDX_bible_game_progress_points_total', ['pointsTotal'], {
  where: 'points_total > 0',
})
@Index('IDX_bible_game_progress_points_daily', ['pointsDaily'], {
  where: 'points_daily > 0',
})
@Index('IDX_bible_game_progress_levels', ['highestPassed', 'pointsLevels'], {
  where: '(points_levels > 0 OR highest_passed > 0)',
})
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

  // All-time points per scoreboard tab: level + mastery rounds, and Daily + weekly rounds.
  @Column({ name: 'points_levels', type: 'int', default: 0 })
  pointsLevels: number;

  @Column({ name: 'points_daily', type: 'int', default: 0 })
  pointsDaily: number;
}
