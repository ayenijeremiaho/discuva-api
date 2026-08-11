import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { GivingProvider } from '../entity/giving-provider.entity';
import { TenantGivingProviderConfig } from '../entity/tenant-giving-provider-config.entity';
import { EncryptionService } from '../../utility/service/encryption.service';
import { CacheService } from '../../utility/service/cache.service';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { UpsertGivingProviderConfigDto } from '../dto/upsert-giving-provider-config.dto';
import { givingProviderCacheKey } from '../utility/giving-provider-cache-key';

export interface GivingProviderConfigSummary {
  providerId: string;
  providerName: string;
  isActive: boolean;
}

// Tenant-facing (AdminGuard) BYOK config for giving-checkout — a church's
// own admin sets their own Paystack/Flutterwave/Kora/Stripe credentials to
// receive tithes/offerings directly. Same shape as
// TenantCommunicationProviderService, minus the channel dimension (giving
// has exactly one "channel").
@Injectable()
export class TenantGivingProviderService {
  constructor(
    private readonly cls: ClsService<AppClsStore>,
    private readonly encryptionService: EncryptionService,
    private readonly cacheService: CacheService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(GivingProvider)
    private readonly providerRepo: Repository<GivingProvider>,
    @InjectRepository(TenantGivingProviderConfig)
    private readonly configRepo: Repository<TenantGivingProviderConfig>,
  ) {}

  private currentTenantId(): string {
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) {
      throw new ForbiddenException('No tenant context for this request.');
    }
    return tenantId;
  }

  private cacheKey(tenantId: string): string {
    return givingProviderCacheKey(tenantId);
  }

  // Catalog (every registered giving vendor) plus this tenant's own config
  // summary for each — never the credentials themselves,
  // `credentialsEncrypted` has `select: false` and this method never
  // selects it back in regardless. `tenantId` rides along so the frontend
  // can build this tenant's own webhook URL
  // (v1/webhooks/giving/:tenantId/:providerId) to hand to Paystack/
  // Flutterwave/etc — nothing else on this tenant-scoped API surface
  // otherwise exposes the tenant's own id to itself.
  //
  // `catalog` excludes a platform-deactivated provider (see
  // PlatformGivingProviderService.setActive) UNLESS this tenant already has
  // a config against it — same "don't make an already-configured row
  // silently vanish" reasoning as
  // TenantCommunicationProviderService.listProviders (discuva-admin's page
  // renders one row per catalog entry).
  async listProviders(): Promise<{
    tenantId: string;
    catalog: GivingProvider[];
    ownConfigs: GivingProviderConfigSummary[];
  }> {
    const tenantId = this.currentTenantId();
    const allProviders = await this.providerRepo.find({
      order: { name: 'ASC' },
    });
    const configs = await this.configRepo.find({ where: { tenantId } });
    const providerById = new Map(allProviders.map((p) => [p.id, p]));
    const configuredProviderIds = new Set(configs.map((c) => c.providerId));

    const ownConfigs: GivingProviderConfigSummary[] = configs.map((c) => ({
      providerId: c.providerId,
      providerName: providerById.get(c.providerId)?.name ?? c.providerId,
      isActive: c.isActive,
    }));

    const catalog = allProviders.filter(
      (p) => p.isActive || configuredProviderIds.has(p.id),
    );

    return { tenantId, catalog, ownConfigs };
  }

  // A tenant can have exactly one active giving vendor at a time — mirrors
  // TenantCommunicationProviderService.deactivateSiblings. GivingCheckoutService
  // resolves a single `isActive = true` row; with more than one active that
  // pick would be arbitrary. Called inside the same transaction as the row
  // being activated so the switch is atomic.
  private async deactivateSiblings(
    manager: EntityManager,
    tenantId: string,
    keepProviderId: string,
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .update(TenantGivingProviderConfig)
      .set({ isActive: false })
      .where('tenantId = :tenantId', { tenantId })
      .andWhere('providerId != :keepProviderId', { keepProviderId })
      .execute();
  }

  async upsertConfig(
    providerId: string,
    dto: UpsertGivingProviderConfigDto,
  ): Promise<GivingProviderConfigSummary> {
    const tenantId = this.currentTenantId();

    const provider = await this.providerRepo.findOneBy({ id: providerId });
    if (!provider) {
      throw new NotFoundException(
        `No giving provider registered with id "${providerId}".`,
      );
    }

    let config = await this.configRepo.findOneBy({ tenantId, providerId });
    if (!config) {
      config = this.configRepo.create({ tenantId, providerId });
    }
    config.credentialsEncrypted = this.encryptionService.encryptFields(
      dto.credentials,
    );
    config.isActive = true;

    await this.dataSource.transaction(async (manager) => {
      await manager.save(config);
      await this.deactivateSiblings(manager, tenantId, providerId);
    });

    this.cacheService.del(this.cacheKey(tenantId));

    return {
      providerId: provider.id,
      providerName: provider.name,
      isActive: config.isActive,
    };
  }

  async setActive(
    providerId: string,
    isActive: boolean,
  ): Promise<GivingProviderConfigSummary> {
    const tenantId = this.currentTenantId();
    const provider = await this.providerRepo.findOneBy({ id: providerId });
    if (!provider) {
      throw new NotFoundException(
        `No giving provider registered with id "${providerId}".`,
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
        await this.deactivateSiblings(manager, tenantId, providerId);
      }
    });

    this.cacheService.del(this.cacheKey(tenantId));

    return {
      providerId: provider.id,
      providerName: provider.name,
      isActive: config.isActive,
    };
  }
}
