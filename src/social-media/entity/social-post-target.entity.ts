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
import { SocialAccount } from './social-account.entity';
import {
  SocialPlacement,
  SocialPostTargetStatus,
} from '../enum/social-media.enum';

// One row per (post, account) pair — the per-platform outcome of a single
// compose-once/publish-everywhere action. Kept separate from SocialPost
// itself so a post's overall status can be derived from these rather than
// hand-maintained, and so each platform's own error is visible individually
// instead of one post-level status hiding which target actually failed.
@Entity({ name: 'social_post_targets' })
export class SocialPostTarget extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @ManyToOne(() => SocialPost, (p) => p.targets, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'social_post_id' })
  post: SocialPost;

  @Index()
  @ManyToOne(() => SocialAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'social_account_id' })
  account: SocialAccount;

  @Column({ default: SocialPostTargetStatus.PENDING })
  status: SocialPostTargetStatus;

  // FEED unless the composer explicitly targeted a Story/Reel — a single
  // connected account can be targeted at multiple placements for the same
  // post (two separate target rows), each validated independently.
  @Column({ default: SocialPlacement.FEED })
  placement: SocialPlacement;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  // The platform's own id for the published post/video — set from
  // PublishResult.externalPostId once a target actually succeeds. What a
  // stats fetch (SocialStatsFetcher) looks up per platform, or any future
  // "open this on the platform" link.
  @Column({ nullable: true, name: 'external_post_id' })
  externalPostId: string | null;

  // "Customize for this platform" — null means this target still shares
  // SocialPost.content. Resolved once, in SocialPostService, never by a
  // publisher itself (see SocialPlatformPublisher's own comment).
  @Column({ type: 'text', nullable: true })
  contentOverride: string | null;

  // Normalized (0-1) click-to-crop-focus point, only meaningful for
  // STORY/REEL placements. Both null (the default) means "let Cloudinary's
  // g_auto content-aware cropping choose" — not "no crop applied." Always
  // set or cleared together; SocialPostService is what enforces that.
  @Column({ type: 'numeric', nullable: true })
  mediaFocalX: number | null;

  @Column({ type: 'numeric', nullable: true })
  mediaFocalY: number | null;
}
