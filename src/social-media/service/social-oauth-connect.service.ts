import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { SocialAccount } from '../entity/social-account.entity';
import { SocialPlatform } from '../enum/social-media.enum';
import { PlatformSocialAppService } from '../../platform-admin/service/platform-social-app.service';
import { OAuthStateService } from '../oauth/oauth-state.service';
import { SocialOAuthExchangerRegistry } from '../oauth/social-oauth-exchanger-registry.service';
import { EncryptionService } from '../../utility/service/encryption.service';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { runInTenantContext } from '../../tenant/utility/run-in-tenant-context';
import { buildAdminUrl } from '../../tenant/utility/tenant-url';

@Injectable()
export class SocialOAuthConnectService {
  private readonly logger = new Logger(SocialOAuthConnectService.name);

  constructor(
    @InjectRepository(SocialAccount)
    private readonly accountRepo: Repository<SocialAccount>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly platformSocialAppService: PlatformSocialAppService,
    private readonly oauthStateService: OAuthStateService,
    private readonly exchangerRegistry: SocialOAuthExchangerRegistry,
    private readonly encryptionService: EncryptionService,
    private readonly configService: ConfigService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  // Called from an authenticated tenant admin request — tenantId comes
  // from the CLS context TenantMiddleware already set up, not from state
  // (state doesn't exist yet, this call is what creates it).
  async getAuthorizeUrl(accountId: string): Promise<string> {
    const account = await this.accountRepo.findOneBy({ id: accountId });
    if (!account) {
      throw new NotFoundException(`Social account "${accountId}" not found.`);
    }

    const resolved = await this.platformSocialAppService.getDecryptedApp(
      account.platform,
    );
    if (!resolved?.app.isActive) {
      throw new ForbiddenException(
        `${account.platform} isn't available to connect right now.`,
      );
    }

    const state = this.oauthStateService.encode(
      accountId,
      this.cls.get('tenantId'),
    );
    const exchanger = this.exchangerRegistry.resolve(account.platform);
    return exchanger.buildAuthorizeUrl(resolved.app, state);
  }

  // Called from the public, tenant-less callback route — everything about
  // which tenant/account this is comes from decoding `state`, since there's
  // no Host-header subdomain to resolve it from otherwise. Returns a
  // discuva-admin URL for the controller to redirect the browser to,
  // success or failure — never throws past this point, since the caller is
  // a browser mid-redirect, not an API client that can read a JSON error.
  async handleCallback(
    platform: SocialPlatform,
    code: string,
    state: string,
  ): Promise<string> {
    const adminUrl = this.configService.get<string>('ADMIN_LOGIN_URL');
    try {
      const decoded = this.oauthStateService.decode(state);

      const resolved =
        await this.platformSocialAppService.getDecryptedApp(platform);
      if (!resolved?.app.isActive) {
        return buildAdminUrl(adminUrl, '/social-media', {
          error: 'platform-disabled',
        });
      }

      const exchanger = this.exchangerRegistry.resolve(platform);
      const result = await exchanger.exchangeCode(
        code,
        resolved.app,
        resolved.clientSecret,
      );

      const tenant = await this.tenantRepo.findOneByOrFail({
        id: decoded.tenantId,
      });

      await runInTenantContext(
        this.cls,
        this.txHost,
        { tenantId: tenant.id, schemaName: tenant.schemaName },
        async () => {
          const account = await this.accountRepo.findOneByOrFail({
            id: decoded.accountId,
          });
          account.accessTokenEncrypted = this.encryptionService.encrypt(
            result.accessToken,
          );
          account.refreshTokenEncrypted = result.refreshToken
            ? this.encryptionService.encrypt(result.refreshToken)
            : null;
          account.tokenExpiresAt = result.expiresInSeconds
            ? new Date(Date.now() + result.expiresInSeconds * 1000)
            : null;
          account.scope = result.scope ?? null;
          account.externalAccountId =
            result.externalAccountId ?? account.externalAccountId;
          account.isConnected = true;
          account.connectedAt = new Date();
          await this.accountRepo.save(account);
        },
      );

      return buildAdminUrl(adminUrl, '/social-media', {
        connected: platform,
      });
    } catch (err) {
      // The redirect back to the browser is deliberately generic (the
      // admin can't act differently on "bad state" vs "exchange failed")
      // but the real cause still needs to land somewhere operators can see
      // it — nothing upstream logs this failure otherwise.
      this.logger.error(
        `Social OAuth callback failed for ${platform}: ${err instanceof Error ? err.message : err}`,
      );
      return buildAdminUrl(adminUrl, '/social-media', {
        error: 'connection-failed',
      });
    }
  }
}
