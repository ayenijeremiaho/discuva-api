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
import { BibleGameRound } from './bible-game-round.entity';
import { BibleGameModeEnum } from '../enum/bible-game-mode.enum';

// The shared points ledger: every Bible game adds rows here, and the scoreboards sum them.
@Entity({ name: 'bible_game_points' })
@Index('IDX_bible_game_points_created', ['createdAt'])
export class BibleGamePoints extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member?: Member;

  @Index('IDX_bible_game_points_member')
  @Column({ name: 'member_id', type: 'uuid' })
  memberId: string;

  @Column({ type: 'varchar' })
  mode: BibleGameModeEnum;

  @Column({ type: 'int' })
  points: number;

  @ManyToOne(() => BibleGameRound, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'round_id' })
  round?: BibleGameRound | null;

  @Column({ name: 'round_id', type: 'uuid', nullable: true })
  roundId: string | null;
}
