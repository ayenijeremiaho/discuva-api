import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Member } from '../../member/entity/member.entity';

export type BibleGameBoard = 'levels' | 'daily' | 'characters';

// Per-tab monthly totals (church timezone); bible_game_monthly holds the All games total.
@Entity({ name: 'bible_game_board_monthly' })
@Index('IDX_bible_game_board_monthly_board', ['month', 'board', 'points'])
@Index(
  'IDX_bible_game_board_monthly_levels',
  ['month', 'levelsPassed', 'points'],
  {
    where: "board = 'levels'",
  },
)
export class BibleGameBoardMonthly extends BaseEntity {
  @PrimaryColumn({ name: 'member_id', type: 'uuid' })
  memberId: string;

  @ManyToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member?: Member;

  @PrimaryColumn({ type: 'date' })
  month: string;

  @PrimaryColumn({ type: 'varchar' })
  board: BibleGameBoard;

  @Column({ type: 'int', default: 0 })
  points: number;

  // Levels first passed this month (Levels tab only).
  @Column({ name: 'levels_passed', type: 'int', default: 0 })
  levelsPassed: number;

  // Characters found this month (Characters tab only).
  @Column({ type: 'int', default: 0 })
  found: number;
}
