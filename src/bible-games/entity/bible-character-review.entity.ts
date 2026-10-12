import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Admin } from '../../admin/entity/admin.entity';

// A church's review of one character from the shipped list (data/characters.json).
@Entity({ name: 'bible_character_reviews' })
export class BibleCharacterReview extends BaseEntity {
  @PrimaryColumn({ name: 'character_id', type: 'varchar' })
  characterId: string;

  @Column({ type: 'boolean', default: false })
  hidden: boolean;

  @Index('IDX_bible_character_reviews_reviewed_by', {
    where: 'reviewed_by_admin_id IS NOT NULL',
  })
  @ManyToOne(() => Admin, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reviewed_by_admin_id' })
  reviewedBy: Admin | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @Column({ name: 'summary_override', type: 'text', nullable: true })
  summaryOverride: string | null;

  @Column({ name: 'clues_override', type: 'jsonb', nullable: true })
  cluesOverride: string[] | null;

  @Index('IDX_bible_character_reviews_updated_by', {
    where: 'updated_by_admin_id IS NOT NULL',
  })
  @ManyToOne(() => Admin, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updated_by_admin_id' })
  updatedBy: Admin | null;
}
