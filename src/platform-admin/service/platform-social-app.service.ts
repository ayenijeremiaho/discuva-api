import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SocialPlatformApp } from '../entity/social-platform-app.entity';
import { SocialPlatform } from '../../social-media/enum/social-media.enum';
import { EncryptionService } from '../../utility/service/encryption.service';
import { RegisterSocialPlatformAppDto } from '../dto/register-social-platform-app.dto';
import {
  KNOWN_SOCIAL_SCOPES,
  SCOPE_SEPARATOR,
} from '../constant/known-social-scopes.constant';

// The platform-wide counterpart to SocialAccount's per-tenant OAuth tokens
// — one row per SocialPlatform, holding the Discuva-owned app credentials
// (Meta App, Google Cloud OAuth client, X developer app) used to build the
// authorize URL and exchange a code for tokens. Mirrors
// PlatformCommunicationProviderService's shape, minus the cache-invalidation
// and tenant-broadcast machinery — publishers resolve isActive live on
// every call (via SocialPublisherRegistry) rather than through a cached
// per-tenant credential resolver, so there's nothing to invalidate here.
@Injectable()
export class PlatformSocialAppService {
  constructor(
    @InjectRepository(SocialPlatformApp)
    private readonly appRepo: Repository<SocialPlatformApp>,
    private readonly encryptionService: EncryptionService,
  ) {}

  // Never returns clientSecretEncrypted — the entity's own `select: false`
  // already keeps it out of this plain find().
  async listApps(): Promise<SocialPlatformApp[]> {
    return this.appRepo.find({ order: { platform: 'ASC' } });
  }

  // Consumed by SocialMediaController's GET available-platforms — a
  // registered-but-inactive app (or no row at all) both mean "not
  // available," same as isPlatformDisabled() but as a list rather than a
  // single-platform check.
  async listActivePlatforms(): Promise<SocialPlatform[]> {
    const apps = await this.appRepo.find({ where: { isActive: true } });
    return apps.map((a) => a.platform);
  }

  async upsertApp(
    dto: RegisterSocialPlatformAppDto,
  ): Promise<SocialPlatformApp> {
    this.validateScopes(dto.platform, dto.scopes);

    const existing = await this.appRepo.findOneBy({ platform: dto.platform });
    const app = existing ?? this.appRepo.create({ platform: dto.platform });
    app.clientId = dto.clientId;
    app.clientSecretEncrypted = this.encryptionService.encrypt(
      dto.clientSecret,
    );
    app.redirectUri = dto.redirectUri;
    app.scopes = dto.scopes.join(SCOPE_SEPARATOR[dto.platform] ?? ' ');
    app.configId = dto.configId ?? null;
    const saved = await this.appRepo.save(app);
    return this.stripSecret(saved);
  }

  // No catalog entry for this platform (X, TikTok — no real exchanger yet)
  // means nothing to validate against; any non-empty list DTO validation
  // already required is accepted. Where a catalog does exist, this is the
  // one place a mistyped or incomplete scope list gets caught — at
  // registration, not weeks later as an inexplicable "missing permission"
  // publish failure.
  private validateScopes(platform: SocialPlatform, scopes: string[]): void {
    const known = KNOWN_SOCIAL_SCOPES[platform];
    if (!known) return;

    const validValues = new Set(known.map((s) => s.value));
    const unknown = scopes.filter((s) => !validValues.has(s));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unrecognized scope(s) for ${platform}: ${unknown.join(', ')}`,
      );
    }

    const missingRequired = known.filter(
      (s) => s.required && !scopes.includes(s.value),
    );
    if (missingRequired.length > 0) {
      throw new BadRequestException(
        `${platform} requires: ${missingRequired.map((s) => s.value).join(', ')}`,
      );
    }
  }

  // A hard delete, unlike setActive()'s soft kill switch — safe here
  // specifically because SocialAccount has no FK to SocialPlatformApp (only
  // a plain platform enum string), so removing a row can't orphan anything
  // relational. An already-connected tenant's SocialAccount tokens are
  // untouched either way; only future authorize-url/connect attempts for
  // this platform start failing honestly (same as before it was ever
  // registered), same as deactivating.
  async deleteApp(platform: SocialPlatform): Promise<void> {
    const result = await this.appRepo.delete({ platform });
    if (result.affected === 0) {
      throw new NotFoundException(
        `Social platform app "${platform}" is not registered.`,
      );
    }
  }

  async setActive(
    platform: SocialPlatform,
    isActive: boolean,
  ): Promise<SocialPlatformApp> {
    const app = await this.appRepo.findOneBy({ platform });
    if (!app) {
      throw new NotFoundException(
        `Social platform app "${platform}" is not registered.`,
      );
    }
    app.isActive = isActive;
    const saved = await this.appRepo.save(app);
    return this.stripSecret(saved);
  }

  // Checked by SocialPublisherRegistry on every resolve() — cheap, no
  // secret decryption, since publishing itself never needs the app's own
  // client secret (only the tenant's own already-issued access token).
  // A platform with no registered app row at all is NOT "disabled" here —
  // that's the pre-launch state NotConnectedPublisher already covers
  // honestly; this only reports true for a platform an admin explicitly
  // switched off.
  async isPlatformDisabled(platform: SocialPlatform): Promise<boolean> {
    const app = await this.appRepo.findOneBy({ platform });
    return app !== null && !app.isActive;
  }

  // Internal use only (OAuth authorize-url / callback flow) — the one
  // place this service actually needs the decrypted secret, so it's the
  // one method that opts back into the select:false column.
  async getDecryptedApp(
    platform: SocialPlatform,
  ): Promise<{ app: SocialPlatformApp; clientSecret: string } | null> {
    const app = await this.appRepo.findOne({
      where: { platform },
      select: [
        'platform',
        'clientId',
        'clientSecretEncrypted',
        'redirectUri',
        'scopes',
        'configId',
        'isActive',
      ],
    });
    if (!app) return null;
    return {
      app,
      clientSecret: this.encryptionService.decrypt(app.clientSecretEncrypted),
    };
  }

  private stripSecret(app: SocialPlatformApp): SocialPlatformApp {
    const { clientSecretEncrypted, ...rest } = app as SocialPlatformApp & {
      clientSecretEncrypted?: string;
    };
    return rest as SocialPlatformApp;
  }
}
