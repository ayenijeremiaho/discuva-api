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
import { Admin } from '../../admin/entity/admin.entity';
import { GameSessionStatusEnum } from '../enum/game-status.enum';

@Entity('game_sessions')
export class GameSession extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => Game, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'game_id' })
  game: Game;

  @Column({ type: 'varchar', unique: true, name: 'session_code' })
  sessionCode: string;

  @Column({ type: 'varchar', default: GameSessionStatusEnum.SCHEDULED })
  status: GameSessionStatusEnum;

  @ManyToOne(() => Admin, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'host_admin_id' })
  hostAdmin: Admin | null;

  @Column({ type: 'int', nullable: true, name: 'current_question_index' })
  currentQuestionIndex: number | null;

  // When the current question started being shown — the speed-bonus scoring
  // window is measured from this, not from when the participant loaded the
  // page, so all participants are scored against the same clock.
  @Column({
    type: 'timestamptz',
    nullable: true,
    name: 'current_question_started_at',
  })
  currentQuestionStartedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'started_at' })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'ended_at' })
  endedAt: Date | null;
}
