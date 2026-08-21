import { Column, Entity, PrimaryColumn } from 'typeorm';
import { SocialPlatform } from '../../social-media/enum/social-media.enum';

// Control-plane table — lives in `public`, never a `search_path` target.
// Unlike CommunicationProvider (tenants BYOK their own SMS/email API key),
// a tenant cannot register their own Meta/Google/X developer app — Discuva
// operates one OAuth app per platform, shared across every tenant. A
// tenant's own connection (the token their admin consents to) lives on
// SocialAccount instead; this table only holds the app-level credentials
// used to build the authorize URL and perform the code-for-token exchange.
@Entity({ name: 'social_platform_apps' })
export class SocialPlatformApp {
  // The platform enum value itself (e.g. 'FACEBOOK') — one row per
  // platform, not a generated id, since there is exactly one app per
  // platform by design.
  @PrimaryColumn()
  platform: SocialPlatform;

  @Column()
  clientId: string;

  @Column({ select: false })
  clientSecretEncrypted: string;

  @Column()
  redirectUri: string;

  @Column()
  scopes: string;

  // The platform-admin kill switch: false rejects new authorize-url
  // requests and makes SocialPublisherRegistry resolve this platform to
  // PlatformDisabledPublisher instead of the real publisher. Never touches
  // an already-connected tenant's SocialAccount tokens either way — same
  // "don't retroactively delete what's already configured" posture as
  // PlatformCommunicationProviderService.setActive().
  @Column({ default: true })
  isActive: boolean;
}
