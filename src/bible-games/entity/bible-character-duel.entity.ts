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
import { Difficulty } from '../engine/characters';
import {
  DuelReason,
  DuelSide,
  DuelSideState,
  DuelWinner,
} from '../engine/duel';

export enum DuelStatus {
  INVITED = 'invited',
  ACTIVE = 'active',
  FINISHED = 'finished',
  DECLINED = 'declined',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

export const OPEN_DUEL_STATUSES = [DuelStatus.INVITED, DuelStatus.ACTIVE];

// A Guess the Bible Character duel: each player has their own character and they take turns.
@Entity({ name: 'bible_character_duels' })
@Index('IDX_bible_character_duels_challenger', ['challengerId', 'createdAt'])
@Index('IDX_bible_character_duels_opponent', ['opponentId', 'createdAt'])
export class BibleCharacterDuel extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'challenger_id' })
  challenger?: Member;

  @Column({ name: 'challenger_id', type: 'uuid' })
  challengerId: string;

  @ManyToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'opponent_id' })
  opponent?: Member;

  @Column({ name: 'opponent_id', type: 'uuid' })
  opponentId: string;

  @Column({ type: 'varchar' })
  difficulty: Difficulty;

  @Column({ type: 'varchar', default: DuelStatus.INVITED })
  status: DuelStatus;

  // Picked when the invite is accepted.
  @Column({ name: 'challenger_character', type: 'varchar', nullable: true })
  challengerCharacter: string | null;

  @Column({ name: 'opponent_character', type: 'varchar', nullable: true })
  opponentCharacter: string | null;

  @Column({
    name: 'challenger_state',
    type: 'jsonb',
    default: () => `'{"asked":[],"hints":0,"wrong":[]}'`,
  })
  challengerState: DuelSideState;

  @Column({
    name: 'opponent_state',
    type: 'jsonb',
    default: () => `'{"asked":[],"hints":0,"wrong":[]}'`,
  })
  opponentState: DuelSideState;

  @Column({ type: 'varchar', nullable: true })
  turn: DuelSide | null;

  @Column({ name: 'turn_number', type: 'int', default: 0 })
  turnNumber: number;

  // Accepting an invite, then each move, must happen before this.
  @Column({ name: 'turn_deadline', type: 'timestamptz', nullable: true })
  turnDeadline: Date | null;

  // The second player's one last guess after the first mover found theirs.
  @Column({ name: 'final_turn', type: 'boolean', default: false })
  finalTurn: boolean;

  @Column({ type: 'varchar', nullable: true })
  winner: DuelWinner | null;

  @Column({ type: 'varchar', nullable: true })
  reason: DuelReason | null;

  @Column({ name: 'challenger_points', type: 'int', default: 0 })
  challengerPoints: number;

  @Column({ name: 'opponent_points', type: 'int', default: 0 })
  opponentPoints: number;

  // True when the side's win counted toward the scoreboard (within the daily limit).
  @Column({ name: 'challenger_scored', type: 'boolean', default: false })
  challengerScored: boolean;

  @Column({ name: 'opponent_scored', type: 'boolean', default: false })
  opponentScored: boolean;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}
