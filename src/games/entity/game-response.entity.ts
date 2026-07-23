import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { GameSession } from './game-session.entity';
import { GameQuestion } from './game-question.entity';
import { GameParticipant } from './game-participant.entity';

@Entity('game_responses')
@Unique(['session', 'question', 'participant'])
export class GameResponse extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => GameSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: GameSession;

  @ManyToOne(() => GameQuestion, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'question_id' })
  question: GameQuestion;

  @ManyToOne(() => GameParticipant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'participant_id' })
  participant: GameParticipant;

  @Column({ type: 'int', name: 'selected_option_index' })
  selectedOptionIndex: number;

  @Column({ type: 'boolean', name: 'is_correct' })
  isCorrect: boolean;

  @Column({ type: 'int', name: 'points_awarded' })
  pointsAwarded: number;

  @Column({ type: 'timestamptz', name: 'answered_at' })
  answeredAt: Date;
}
