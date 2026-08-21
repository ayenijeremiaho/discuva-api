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
import { SocialPostMedia } from './social-post-media.entity';

@Entity({ name: 'social_posts' })
export class SocialPost extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  content: string;

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

  // Set only for status = SCHEDULED — when the delayed Bull job created for
  // this post fires, it calls the same publish() path "Publish Now" does.
  @Column({ type: 'timestamptz', nullable: true })
  scheduledFor: Date | null;

  @OneToMany(() => SocialPostTarget, (t) => t.post, { cascade: true })
  targets: SocialPostTarget[];

  @OneToMany(() => SocialPostMedia, (m) => m.post, { cascade: true })
  media: SocialPostMedia[];
}
