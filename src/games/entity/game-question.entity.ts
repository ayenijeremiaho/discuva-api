import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Game } from './game.entity';

@Entity('game_questions')
export class GameQuestion extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => Game, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'game_id' })
  game: Game;

  @Column({ type: 'int' })
  order: number;

  @Column({ type: 'text', name: 'question_text' })
  questionText: string;

  @Column({ type: 'jsonb' })
  options: string[];

  @Column({ type: 'int', name: 'correct_option_index' })
  correctOptionIndex: number;

  @Column({ type: 'int', default: 1000 })
  points: number;

  @Column({ type: 'int', default: 20, name: 'time_limit_seconds' })
  timeLimitSeconds: number;
}
