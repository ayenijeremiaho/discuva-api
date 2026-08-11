import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CommunicationProvider } from '../entity/communication-provider.entity';
import { TenantCommunicationProviderConfig } from '../entity/tenant-communication-provider-config.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { RegisterCommunicationProviderDto } from '../dto/register-communication-provider.dto';
import { CacheService } from '../../utility/service/cache.service';
import { communicationProviderCacheKey } from '../../communication-provider/utility/communication-provider-cache-key';
import { TenantBroadcastService } from './tenant-broadcast.service';

export interface TenantProviderSummary {
  providerId: string;
  channel: string;
  providerName: string;
  senderIdentity: string | null;
  isActive: boolean;
}

@Injectable()
export class PlatformCommunicationProviderService {
  constructor(
    @InjectRepository(CommunicationProvider)
    private readonly providerRepo: Repository<CommunicationProvider>,
    @InjectRepository(TenantCommunicationProviderConfig)
    private readonly tenantProviderConfigRepo: Repository<TenantCommunicationProviderConfig>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly cacheService: CacheService,
    private readonly tenantBroadcastService: TenantBroadcastService,
  ) {}

  async listProviders(): Promise<CommunicationProvider[]> {
    return this.providerRepo.find({ order: { channel: 'ASC', name: 'ASC' } });
  }

  async registerProvider(
    dto: RegisterCommunicationProviderDto,
  ): Promise<CommunicationProvider> {
    const existing = await this.providerRepo.findOneBy({ id: dto.id });
    if (existing) {
      throw new ConflictException(
        `Communication provider "${dto.id}" already exists.`,
      );
    }
    return this.providerRepo.save(this.providerRepo.create(dto));
  }

  // Deactivating removes the provider from the tenant-facing catalog a NEW
  // tenant can pick (TenantCommunicationProviderService.listProviders) and
  // stops it resolving for a tenant ALREADY configured against it
  // (SmsCredentialResolverService/EmailCredentialResolverService now check
  // provider.isActive too) — but it deliberately never touches a tenant's
  // own TenantCommunicationProviderConfig row itself, same "don't
  // retroactively delete something already configured" posture as
  // suspendTenant leaving a tenant's own data untouched. Reactivating just
  // undoes both effects; the tenant's config row was never modified either
  // way, so there's nothing to restore on that side.
  //
  // The credential resolvers cache resolved config for 300s — without
  // explicit invalidation here, a tenant already mid-cache-window would
  // keep sending through a "deactivated" provider for up to 5 more minutes.
  // Every tenant with an ACTIVE config against this provider gets their
  // cache invalidated immediately, and gets emailed (via
  // TenantBroadcastService, not a single batched call — see its own class
  // comment) explaining the channel is disrupted/restored. Deliberately
  // targets only tenants actually using this provider, not every tenant on
  // the platform.
  async setActive(
    id: string,
    isActive: boolean,
  ): Promise<CommunicationProvider> {
    const provider = await this.providerRepo.findOneBy({ id });
    if (!provider) {
      throw new NotFoundException(`Communication provider "${id}" not found.`);
    }
    provider.isActive = isActive;
    const saved = await this.providerRepo.save(provider);

    const affectedConfigs = await this.tenantProviderConfigRepo.find({
      where: { providerId: id, isActive: true },
    });

    for (const config of affectedConfigs) {
      this.cacheService.del(
        communicationProviderCacheKey(config.tenantId, provider.channel),
      );
    }

    if (affectedConfigs.length > 0) {
      const tenantIds = affectedConfigs.map((c) => c.tenantId);
      const subject = isActive
        ? `${provider.name} is available again`
        : `${provider.name} is temporarily unavailable`;
      const message = isActive
        ? `Your ${provider.channel.toUpperCase()} provider, ${provider.name}, is available again. No action is needed on your end.`
        : `Your ${provider.channel.toUpperCase()} provider, ${provider.name}, is temporarily unavailable due to an issue on our end. We're working on it — no action is needed on your end, and we'll notify you again once it's restored.`;
      this.tenantBroadcastService.notifyTenants(
        tenantIds,
        subject,
        `<p>${message}</p>`,
      );
    }

    return saved;
  }

  // Never returns credentialsEncrypted — the entity's own `select: false`
  // already keeps it out of a plain find(), and this method doesn't
  // addSelect it back in. Support cases need "which provider, BYOK or not"
  // (§7), never the raw secret.
  async getTenantProviders(
    tenantId: string,
  ): Promise<{ providers: TenantProviderSummary[] }> {
    const tenant = await this.tenantRepo.findOneBy({ id: tenantId });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const configs = await this.tenantProviderConfigRepo.find({
      where: { tenantId },
    });

    const providerIds = configs.map((c) => c.providerId);
    const providers = providerIds.length
      ? await this.providerRepo.findBy({ id: In(providerIds) })
      : [];
    const providerById = new Map(providers.map((p) => [p.id, p]));

    return {
      providers: configs.map((config) => ({
        providerId: config.providerId,
        channel: providerById.get(config.providerId)?.channel ?? 'unknown',
        providerName:
          providerById.get(config.providerId)?.name ?? config.providerId,
        senderIdentity: config.senderIdentity,
        isActive: config.isActive,
      })),
    };
  }
}
