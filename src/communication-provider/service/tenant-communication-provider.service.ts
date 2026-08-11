import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { CommunicationProvider } from '../../platform-admin/entity/communication-provider.entity';
import { TenantCommunicationProviderConfig } from '../../platform-admin/entity/tenant-communication-provider-config.entity';
import { EncryptionService } from '../../utility/service/encryption.service';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { UpsertProviderConfigDto } from '../dto/upsert-provider-config.dto';
import { CacheService } from '../../utility/service/cache.service';
import { communicationProviderCacheKey } from '../utility/communication-provider-cache-key';

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
    @InjectDataSource() private readonly dataSource: DataSource,
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
    return communicationProviderCacheKey(tenantId, channel);
  }

  // Catalog (every provider registered for the given channel, or all
  // channels) plus this tenant's own config summary for each — never the
  // credentials themselves, `credentialsEncrypted` has `select: false` and
  // this method never selects it back in regardless.
  //
  // `catalog` excludes providers the platform has deactivated (see
  // PlatformCommunicationProviderService.setActive) UNLESS this tenant is
  // already configured against one — a deactivated-but-still-configured
  // provider stays visible (discuva-admin's page renders one row per
  // catalog entry, so filtering it out entirely would make an
  // already-set-up provider's row silently vanish with no explanation,
  // even though its encrypted credentials are still saved). The tenant is
  // notified separately via TenantBroadcastService when this happens.
  async listProviders(channel?: 'sms' | 'email'): Promise<{
    catalog: CommunicationProvider[];
    ownConfigs: TenantProviderConfigSummary[];
  }> {
    const tenantId = this.currentTenantId();
    const allProviders = await this.providerRepo.find({
      where: channel ? { channel } : {},
      order: { channel: 'ASC', name: 'ASC' },
    });

    const configs = await this.configRepo.find({ where: { tenantId } });
    const providerById = new Map(allProviders.map((p) => [p.id, p]));
    const configuredProviderIds = new Set(configs.map((c) => c.providerId));

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

    const catalog = allProviders.filter(
      (p) => p.isActive || configuredProviderIds.has(p.id),
    );

    return { catalog, ownConfigs };
  }

  // A tenant can have exactly one active vendor per channel at a time — the
  // credential resolvers (SmsCredentialResolverService,
  // EmailCredentialResolverService) each pick a single `isActive = true` row
  // per channel, and with more than one active that pick would be
  // arbitrary. Called inside the same transaction as the row being
  // activated so the switch is atomic, not "deactivate everything, then
  // hope the activate step also succeeds."
  private async deactivateSiblings(
    manager: EntityManager,
    tenantId: string,
    channel: 'sms' | 'email',
    keepProviderId: string,
  ): Promise<void> {
    const siblingProviders = await this.providerRepo.find({
      where: { channel },
    });
    const siblingIds = siblingProviders
      .map((p) => p.id)
      .filter((id) => id !== keepProviderId);
    if (siblingIds.length === 0) return;

    await manager
      .createQueryBuilder()
      .update(TenantCommunicationProviderConfig)
      .set({ isActive: false })
      .where('tenantId = :tenantId', { tenantId })
      .andWhere('providerId IN (:...siblingIds)', { siblingIds })
      .execute();
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

    await this.dataSource.transaction(async (manager) => {
      await manager.save(config);
      await this.deactivateSiblings(manager, tenantId, channel, dto.providerId);
    });

    // SmsCredentialResolverService (and its email counterpart) cache
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

    await this.dataSource.transaction(async (manager) => {
      await manager.save(config);
      if (isActive) {
        await this.deactivateSiblings(manager, tenantId, channel, providerId);
      }
    });

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
