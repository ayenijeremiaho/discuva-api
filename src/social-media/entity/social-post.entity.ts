import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { Admin } from '../../admin/entity/admin.entity';
import { SocialPostStatus } from '../enum/social-media.enum';
import { SocialPostTarget } from './social-post-target.entity';

@Entity({ name: 'social_posts' })
export class SocialPost extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ nullable: true })
  imageUrl: string | null;

  @Column({ default: SocialPostStatus.DRAFT })
  status: SocialPostStatus;

  // idx_social_posts_created_by already exists in the DB (added by
  // AddMissingForeignKeyIndexes) — this decorator was missing, purely
  // cosmetic drift between the entity and reality until now.
  @Index()
  @ManyToOne(() => Admin, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdBy: Admin | null;

  @Column({ type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @OneToMany(() => SocialPostTarget, (t) => t.post, { cascade: true })
  targets: SocialPostTarget[];
}
