import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../../utility/entity/base.entity';

// Control-plane table — lives in `public`, never a `search_path` target.
// See src/migrations/1790812800000-AddTenantYoutubeIntegrations.ts for why
// this replaced the old tenant-schema youtube_integration_state: a WebSub
// notification from Google carries a channel id and nothing else that
// identifies a tenant, so "which tenant owns this channel" has to be
// resolvable without already knowing the tenant.
@Entity({ name: 'tenant_youtube_integrations' })
export class TenantYoutubeIntegration extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  tenantId: string;

  @Index({ unique: true })
  @Column()
  channelId: string;

  // Tenant's own YouTube Data API key (BYOK), encrypted at rest via
  // EncryptionService — falls back to this platform's own YOUTUBE_API_KEY
  // when a tenant hasn't set one (see YoutubeLiveDetectionService). Unlike
  // SMS's apiKey, this isn't strictly required to be tenant-specific for
  // correctness (any valid Data API key can look up any public channel's
  // video snippet) — it's BYOK by choice, so each tenant's own quota is
  // theirs alone, not to satisfy some access-control need.
  @Column({ nullable: true, select: false })
  apiKeyEncrypted: string | null;

  @Column({ nullable: true })
  lastAnnouncedVideoId: string | null;

  @Column({ nullable: true, type: 'timestamptz' })
  subscriptionExpiresAt: Date | null;

  @Column({ default: true })
  isActive: boolean;
}
