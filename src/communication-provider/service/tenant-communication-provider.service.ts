import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { CommunicationProvider } from '../../platform-admin/entity/communication-provider.entity';
import { TenantCommunicationProviderConfig } from '../../platform-admin/entity/tenant-communication-provider-config.entity';
import { EncryptionService } from '../../utility/service/encryption.service';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { UpsertProviderConfigDto } from '../dto/upsert-provider-config.dto';
import { CacheService } from '../../utility/service/cache.service';

export interface TenantProviderConfigSummary {
  providerId: string;
  providerName: string;
  channel: string;
  senderIdentity: string | null;
  isActive: boolean;
}

// Tenant-facing (AdminGuard) counterpart to
// PlatformCommunicationProviderService — that one is platform-admin-only,
// read-only for a tenant's config, and can register new provider catalog
// entries. This one is what a church's own admin uses to actually set
// their BYOK credentials (docs/MULTI_TENANT_MIGRATION.md §Phase 6c's
// deferred "write side", now built).
@Injectable()
export class TenantCommunicationProviderService {
  constructor(
    private readonly cls: ClsService<AppClsStore>,
    private readonly encryptionService: EncryptionService,
    private readonly cacheService: CacheService,
    @InjectRepository(CommunicationProvider)
    private readonly providerRepo: Repository<CommunicationProvider>,
    @InjectRepository(TenantCommunicationProviderConfig)
    private readonly configRepo: Repository<TenantCommunicationProviderConfig>,
  ) {}

  private currentTenantId(): string {
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) {
      throw new ForbiddenException('No tenant context for this request.');
    }
    return tenantId;
  }

  private cacheKey(tenantId: string, channel: string): string {
    return `communication-provider-config:${tenantId}:${channel}`;
  }

  // Catalog (every provider registered for the given channel, or all
  // channels) plus this tenant's own config summary for each — never the
  // credentials themselves, `credentialsEncrypted` has `select: false` and
  // this method never selects it back in regardless.
  async listProviders(channel?: 'sms' | 'email'): Promise<{
    catalog: CommunicationProvider[];
    ownConfigs: TenantProviderConfigSummary[];
  }> {
    const tenantId = this.currentTenantId();
    const catalog = await this.providerRepo.find({
      where: channel ? { channel } : {},
      order: { channel: 'ASC', name: 'ASC' },
    });

    const configs = await this.configRepo.find({ where: { tenantId } });
    const providerById = new Map(catalog.map((p) => [p.id, p]));
    const ownConfigs: TenantProviderConfigSummary[] = configs
      .filter(
        (c) => !channel || providerById.get(c.providerId)?.channel === channel,
      )
      .map((c) => ({
        providerId: c.providerId,
        providerName: providerById.get(c.providerId)?.name ?? c.providerId,
        channel: providerById.get(c.providerId)?.channel ?? 'unknown',
        senderIdentity: c.senderIdentity,
        isActive: c.isActive,
      }));

    return { catalog, ownConfigs };
  }

  async upsertConfig(
    channel: 'sms' | 'email',
    dto: UpsertProviderConfigDto,
  ): Promise<TenantProviderConfigSummary> {
    const tenantId = this.currentTenantId();

    const provider = await this.providerRepo.findOneBy({
      id: dto.providerId,
      channel,
    });
    if (!provider) {
      throw new NotFoundException(
        `No "${channel}" provider registered with id "${dto.providerId}".`,
      );
    }

    let config = await this.configRepo.findOneBy({
      tenantId,
      providerId: dto.providerId,
    });
    if (!config) {
      config = this.configRepo.create({ tenantId, providerId: dto.providerId });
    }
    config.credentialsEncrypted = this.encryptionService.encryptFields(
      dto.credentials,
    );
    config.senderIdentity = dto.senderIdentity ?? null;
    config.isActive = true;
    await this.configRepo.save(config);

    // SmsCredentialResolverService (and its future email counterpart) cache
    // resolved credentials per (tenant, channel) — invalidate immediately so
    // a just-saved credential is used on the very next send, not after
    // whatever TTL that cache uses expires.
    this.cacheService.del(this.cacheKey(tenantId, channel));

    return {
      providerId: provider.id,
      providerName: provider.name,
      channel: provider.channel,
      senderIdentity: config.senderIdentity,
      isActive: config.isActive,
    };
  }

  async setActive(
    channel: 'sms' | 'email',
    providerId: string,
    isActive: boolean,
  ): Promise<TenantProviderConfigSummary> {
    const tenantId = this.currentTenantId();
    const provider = await this.providerRepo.findOneBy({
      id: providerId,
      channel,
    });
    if (!provider) {
      throw new NotFoundException(
        `No "${channel}" provider registered with id "${providerId}".`,
      );
    }
    const config = await this.configRepo.findOneBy({ tenantId, providerId });
    if (!config) {
      throw new NotFoundException(
        `No credentials configured for "${providerId}" yet — set them before enabling.`,
      );
    }
    config.isActive = isActive;
    await this.configRepo.save(config);
    this.cacheService.del(this.cacheKey(tenantId, channel));

    return {
      providerId: provider.id,
      providerName: provider.name,
      channel: provider.channel,
      senderIdentity: config.senderIdentity,
      isActive: config.isActive,
    };
  }
}
