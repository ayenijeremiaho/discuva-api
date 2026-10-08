import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Admin } from '../../admin/entity/admin.entity';

// A question the church wrote, mixed into level rounds within its level range.
@Entity({ name: 'bible_game_custom_questions' })
export class BibleGameCustomQuestion extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  prompt: string;

  @Column({ type: 'jsonb' })
  options: string[];

  @Column({ type: 'int' })
  answer: number;

  @Column({ type: 'text', nullable: true })
  explain: string | null;

  @Column({ name: 'level_min', type: 'int', default: 1 })
  levelMin: number;

  @Column({ name: 'level_max', type: 'int', default: 20 })
  levelMax: number;

  @Column({ default: true })
  active: boolean;

  @ManyToOne(() => Admin, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_admin_id' })
  createdByAdmin?: Admin | null;

  @Column({ name: 'created_by_admin_id', type: 'uuid', nullable: true })
  createdByAdminId: string | null;
}
