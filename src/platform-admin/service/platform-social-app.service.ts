import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SocialPlatformApp } from '../entity/social-platform-app.entity';
import { SocialPlatform } from '../../social-media/enum/social-media.enum';
import { EncryptionService } from '../../utility/service/encryption.service';
import { RegisterSocialPlatformAppDto } from '../dto/register-social-platform-app.dto';

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

  async upsertApp(
    dto: RegisterSocialPlatformAppDto,
  ): Promise<SocialPlatformApp> {
    const existing = await this.appRepo.findOneBy({ platform: dto.platform });
    const app = existing ?? this.appRepo.create({ platform: dto.platform });
    app.clientId = dto.clientId;
    app.clientSecretEncrypted = this.encryptionService.encrypt(
      dto.clientSecret,
    );
    app.redirectUri = dto.redirectUri;
    app.scopes = dto.scopes;
    const saved = await this.appRepo.save(app);
    return this.stripSecret(saved);
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
