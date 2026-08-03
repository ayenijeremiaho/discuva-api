import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TenantCommunicationProviderConfig } from '../../platform-admin/entity/tenant-communication-provider-config.entity';
import { CommunicationProvider } from '../../platform-admin/entity/communication-provider.entity';
import { EncryptionService } from '../../utility/service/encryption.service';
import { CacheService } from '../../utility/service/cache.service';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';

export interface ResolvedEmailConfig {
  providerId: string;
  credentials: Record<string, string>;
  // Reuses the same senderIdentity field SMS uses for its sender id — for
  // email this is the "from" address, since a tenant sending through their
  // own Gmail/Resend account almost always wants outbound mail to show as
  // coming from their own address, not the platform's.
  senderIdentity: string | null;
}

// Email counterpart to SmsCredentialResolverService, foreshadowed in
// TenantCommunicationProviderService's own comment. Two differences from
// the SMS version:
// - Returns providerId alongside credentials, not just credentials — SMS
//   only ever has one real provider (Termii) so the caller can assume which
//   shape the credentials are in; email has two (gmail, resend) with
//   incompatible credential shapes, so EmailProcessor needs to know which
//   concrete IEmailProvider to hand them to.
// - No wallet/debit concept — a tenant without their own BYOK email
//   provider just uses this platform's own constructor-injected default
//   (EMAIL_PROVIDER_TOKEN), no prepaid balance involved.
@Injectable()
export class EmailCredentialResolverService {
  constructor(
    private readonly cls: ClsService<AppClsStore>,
    private readonly encryptionService: EncryptionService,
    private readonly cacheService: CacheService,
    @InjectRepository(TenantCommunicationProviderConfig)
    private readonly configRepo: Repository<TenantCommunicationProviderConfig>,
  ) {}

  private currentTenantId(): string | undefined {
    return this.cls.get('tenantId');
  }

  private cacheKey(tenantId: string): string {
    return `communication-provider-config:${tenantId}:email`;
  }

  // Returns undefined when the tenant should fall back to the platform
  // default — either no tenant context at all (a job with no envelope), or
  // no active BYOK config for email specifically. Cache key/invalidation is
  // shared with TenantCommunicationProviderService's own del() call — no
  // changes needed there for this to stay correctly invalidated on write.
  async resolveConfig(): Promise<ResolvedEmailConfig | undefined> {
    const tenantId = this.currentTenantId();
    if (!tenantId) return undefined;

    return this.cacheService
      .getOrSet(
        this.cacheKey(tenantId),
        async () => {
          const config = await this.configRepo
            .createQueryBuilder('config')
            .innerJoin(
              CommunicationProvider,
              'provider',
              'provider.id = config.providerId',
            )
            .addSelect('config.credentialsEncrypted')
            .where('config.tenantId = :tenantId', { tenantId })
            .andWhere('config.isActive = true')
            .andWhere('provider.channel = :channel', { channel: 'email' })
            .getOne();

          // Cast to a sentinel rather than returning undefined here — see
          // SmsCredentialResolverService's identical comment for why.
          if (!config) return null;
          return {
            providerId: config.providerId,
            credentials: this.encryptionService.decryptFields(
              config.credentialsEncrypted as Record<string, string>,
            ),
            senderIdentity: config.senderIdentity,
          };
        },
        300,
      )
      .then((cached) => cached ?? undefined);
  }
}
