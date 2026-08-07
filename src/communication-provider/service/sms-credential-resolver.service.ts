import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TenantCommunicationProviderConfig } from '../../platform-admin/entity/tenant-communication-provider-config.entity';
import { CommunicationProvider } from '../../platform-admin/entity/communication-provider.entity';
import { EncryptionService } from '../../utility/service/encryption.service';
import { CacheService } from '../../utility/service/cache.service';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';

export interface ResolvedSmsConfig {
  providerId: string;
  credentials: Record<string, string>;
}

// Pure BYOK — SMS has no platform-default fallback (no SmsWallet, removed
// in favour of every tenant configuring their own SMS provider). Resolves
// which provider (Termii, Twilio, ...) a tenant has active for the 'sms'
// channel and their decrypted credentials for it; SmsService's dispatch to
// the matching ISmsProvider happens via SmsProviderRegistryService.
@Injectable()
export class SmsCredentialResolverService {
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
    return `communication-provider-config:${tenantId}:sms`;
  }

  // Returns undefined when there's no tenant context at all (a script/job
  // with no envelope) or the tenant hasn't configured an active SMS
  // provider yet — callers must treat that as "can't send", not "use a
  // default", since none exists.
  async resolveConfig(): Promise<ResolvedSmsConfig | undefined> {
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
            .andWhere('provider.channel = :channel', { channel: 'sms' })
            .getOne();

          // Cast to a sentinel rather than returning undefined here — see the
          // getOrSet-unwrap comment below for why.
          if (!config) return null;
          return {
            providerId: config.providerId,
            credentials: this.encryptionService.decryptFields(
              config.credentialsEncrypted as Record<string, string>,
            ),
          };
        },
        300,
      )
      .then((cached) => cached ?? undefined);
    // CacheService.getOrSet only skips re-fetching when the cached value
    // isn't `undefined` — caching `undefined` itself for "not configured"
    // would defeat the cache (every call would re-query), so the fetcher
    // above caches `null` instead and this unwraps it back to undefined for
    // callers.
  }
}
