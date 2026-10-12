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
import { AskedQuestion } from '../engine/character-game';
import { Difficulty } from '../engine/characters';

export enum CharacterRoundStatus {
  ACTIVE = 'active',
  WON = 'won',
  LOST = 'lost',
  GAVE_UP = 'gave_up',
  ABANDONED = 'abandoned',
}

// One Solo game of Guess the Bible Character.
@Entity({ name: 'bible_character_rounds' })
@Index('UQ_bible_character_rounds_active', ['memberId'], {
  unique: true,
  where: "status = 'active'",
})
@Index('IDX_bible_character_rounds_member_created', ['memberId', 'createdAt'])
@Index('IDX_bible_character_rounds_finished', ['finishedAt', 'characterId'], {
  where: 'finished_at IS NOT NULL',
})
export class BibleCharacterRound extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Member, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'member_id' })
  member?: Member;

  @Column({ name: 'member_id', type: 'uuid' })
  memberId: string;

  @Column({ name: 'character_id', type: 'varchar' })
  characterId: string;

  @Column({ type: 'varchar' })
  difficulty: Difficulty;

  @Column({ type: 'varchar', default: CharacterRoundStatus.ACTIVE })
  status: CharacterRoundStatus;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  asked: AskedQuestion[];

  @Column({ type: 'int', default: 0 })
  hints: number;

  @Column({ name: 'wrong_guesses', type: 'jsonb', default: () => "'[]'" })
  wrongGuesses: string[];

  @Column({ type: 'int', default: 0 })
  points: number;

  // True when the win counted toward the scoreboard (within the daily limit).
  @Column({ type: 'boolean', default: false })
  scored: boolean;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}
