import {
  BadRequestException,
  Injectable,
  Logger,
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
const META_PLATFORMS = new Set([
  SocialPlatform.FACEBOOK,
  SocialPlatform.INSTAGRAM,
]);
const META_ID = /^\d{5,20}$/;
const META_CHECK_TIMEOUT_MS = 8000;
const WHERE_APP_ID =
  'Use the App ID from developers.facebook.com → your app → App settings → Basic. Facebook and Instagram both use this same App ID, not the "Instagram app ID" shown under the Instagram product.';

@Injectable()
export class PlatformSocialAppService {
  private readonly logger = new Logger(PlatformSocialAppService.name);

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
    // Pasted IDs often carry a space or line break, which Meta then rejects as an invalid app.
    const clientId = dto.clientId.trim();
    const configId = dto.configId?.trim() || null;
    if (META_PLATFORMS.has(dto.platform))
      await this.checkMetaApp(clientId, dto.clientSecret.trim(), configId);

    const existing = await this.appRepo.findOneBy({ platform: dto.platform });
    const app = existing ?? this.appRepo.create({ platform: dto.platform });
    app.clientId = clientId;
    app.clientSecretEncrypted = this.encryptionService.encrypt(
      dto.clientSecret.trim(),
    );
    app.redirectUri = dto.redirectUri.trim();
    app.scopes = dto.scopes.join(SCOPE_SEPARATOR[dto.platform] ?? ' ');
    app.configId = configId;
    const saved = await this.appRepo.save(app);
    return this.stripSecret(saved);
  }

  // Asks Meta whether this App ID and secret belong to a real app, so a wrong value is caught here rather than as
  // Facebook's "invalid app ID" page when a church tries to connect.
  private async checkMetaApp(
    clientId: string,
    clientSecret: string,
    configId: string | null,
  ): Promise<void> {
    if (!META_ID.test(clientId))
      throw new BadRequestException(
        `"${clientId}" isn't a Meta App ID (it's a number). ${WHERE_APP_ID}`,
      );
    if (configId && !META_ID.test(configId))
      throw new BadRequestException(
        `"${configId}" isn't a Configuration ID (it's a number). Copy it from Facebook Login for Business → Configurations.`,
      );
    let body: { id?: string; error?: { message?: string; code?: number } };
    try {
      const response = await fetch(
        `https://graph.facebook.com/v21.0/${clientId}?fields=id,name&access_token=${encodeURIComponent(`${clientId}|${clientSecret}`)}`,
        { signal: AbortSignal.timeout(META_CHECK_TIMEOUT_MS) },
      );
      body = (await response.json().catch(() => ({}))) as typeof body;
    } catch (err) {
      this.logger.warn(`Meta app check failed: ${(err as Error).message}`);
      throw new BadRequestException(
        "Couldn't reach Meta to check this App ID. Please try again in a moment.",
      );
    }
    if (body.id === clientId) return;
    const message = body.error?.message ?? 'Meta did not recognise this app.';
    if (/signature|secret/i.test(message))
      throw new BadRequestException(
        "That App Secret doesn't match this App ID. Copy it again from App settings → Basic → App Secret.",
      );
    throw new BadRequestException(
      `Meta doesn't recognise App ID ${clientId} (${message}). ${WHERE_APP_ID}`,
    );
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
    // Rows saved before values were trimmed on save may carry a pasted space or line break.
    app.clientId = app.clientId.trim();
    app.redirectUri = app.redirectUri.trim();
    app.configId = app.configId?.trim() || null;
    return {
      app,
      clientSecret: this.encryptionService
        .decrypt(app.clientSecretEncrypted)
        .trim(),
    };
  }

  private stripSecret(app: SocialPlatformApp): SocialPlatformApp {
    const { clientSecretEncrypted, ...rest } = app as SocialPlatformApp & {
      clientSecretEncrypted?: string;
    };
    return rest as SocialPlatformApp;
  }
}
