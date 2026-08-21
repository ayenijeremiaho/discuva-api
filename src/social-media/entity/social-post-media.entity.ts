import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../utility/entity/base.entity';
import { SocialPost } from './social-post.entity';

// Replaces SocialPost.imageUrl (a single free-text URL, never a real
// upload) — supports multiple attachments per post (X allows up to 4
// images; Instagram carousels are a natural future extension) and carries
// enough metadata (mimeType, dimensions/duration) for
// SocialMediaValidationService to check against each target's
// (platform, placement) constraints without re-inspecting the file itself.
@Entity({ name: 'social_post_media' })
export class SocialPostMedia extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => SocialPost, (p) => p.media, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'social_post_id' })
  post: SocialPost;

  @Column()
  url: string;

  // Cloudinary's own asset identifier — needed to actually delete the
  // asset (not just the DB row) when the retention job runs.
  @Column()
  publicId: string;

  @Column()
  mimeType: string;

  @Column({ type: 'bigint' })
  sizeBytes: number;

  @Column({ type: 'int', nullable: true })
  width: number | null;

  @Column({ type: 'int', nullable: true })
  height: number | null;

  @Column({ type: 'numeric', nullable: true })
  durationSeconds: number | null;

  @Column({ default: 0 })
  order: number;
}
