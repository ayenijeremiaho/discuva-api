import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { GivingProvider } from '../../giving-checkout/entity/giving-provider.entity';
import { TenantGivingProviderConfig } from '../../giving-checkout/entity/tenant-giving-provider-config.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { RegisterGivingProviderDto } from '../dto/register-giving-provider.dto';
import { CacheService } from '../../utility/service/cache.service';
import { givingProviderCacheKey } from '../../giving-checkout/utility/giving-provider-cache-key';
import { TenantBroadcastService } from './tenant-broadcast.service';

export interface TenantGivingProviderSummary {
  providerId: string;
  providerName: string;
  isActive: boolean;
}

// Platform-admin-only. Was originally just a support lookup (mirrors
// PlatformCommunicationProviderService.getTenantProviders(), for
// giving-checkout instead of SMS/email) — listProviders/registerProvider/
// setActive added alongside communication providers' equivalents (see
// docs/TECH_DOC.md's "Communication Providers: deactivation has real
// consequences" for the parallel enforcement story on the giving side).
// Never returns credentials — TenantGivingProviderConfig.credentialsEncrypted
// has `select: false` and this never selects it back in.
@Injectable()
export class PlatformGivingProviderService {
  constructor(
    @InjectRepository(GivingProvider)
    private readonly providerRepo: Repository<GivingProvider>,
    @InjectRepository(TenantGivingProviderConfig)
    private readonly configRepo: Repository<TenantGivingProviderConfig>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly cacheService: CacheService,
    private readonly tenantBroadcastService: TenantBroadcastService,
  ) {}

  async listProviders(): Promise<GivingProvider[]> {
    return this.providerRepo.find({ order: { name: 'ASC' } });
  }

  async registerProvider(
    dto: RegisterGivingProviderDto,
  ): Promise<GivingProvider> {
    const existing = await this.providerRepo.findOneBy({ id: dto.id });
    if (existing) {
      throw new ConflictException(
        `Giving provider "${dto.id}" already exists.`,
      );
    }
    return this.providerRepo.save(this.providerRepo.create(dto));
  }

  // Mirrors PlatformCommunicationProviderService.setActive exactly — see
  // its own comment for the full reasoning (cache invalidation, targeted
  // broadcast, never touching a tenant's own config row). No channel
  // dimension here, so no per-channel cache-key loop needed.
  async setActive(id: string, isActive: boolean): Promise<GivingProvider> {
    const provider = await this.providerRepo.findOneBy({ id });
    if (!provider) {
      throw new NotFoundException(`Giving provider "${id}" not found.`);
    }
    provider.isActive = isActive;
    const saved = await this.providerRepo.save(provider);

    const affectedConfigs = await this.configRepo.find({
      where: { providerId: id, isActive: true },
    });

    for (const config of affectedConfigs) {
      this.cacheService.del(givingProviderCacheKey(config.tenantId));
    }

    if (affectedConfigs.length > 0) {
      const tenantIds = affectedConfigs.map((c) => c.tenantId);
      const subject = isActive
        ? `${provider.name} is available again`
        : `${provider.name} is temporarily unavailable`;
      const message = isActive
        ? `Your giving provider, ${provider.name}, is available again. No action is needed on your end.`
        : `Your giving provider, ${provider.name}, is temporarily unavailable due to an issue on our end. Giving via checkout through it is paused until it's restored — no action is needed on your end.`;
      this.tenantBroadcastService.notifyTenants(
        tenantIds,
        subject,
        `<p>${message}</p>`,
      );
    }

    return saved;
  }

  async getTenantGivingProviders(
    tenantId: string,
  ): Promise<{ providers: TenantGivingProviderSummary[] }> {
    const tenant = await this.tenantRepo.findOneBy({ id: tenantId });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const configs = await this.configRepo.find({ where: { tenantId } });
    const providerIds = configs.map((c) => c.providerId);
    const providers = providerIds.length
      ? await this.providerRepo.findBy({ id: In(providerIds) })
      : [];
    const providerById = new Map(providers.map((p) => [p.id, p]));

    return {
      providers: configs.map((config) => ({
        providerId: config.providerId,
        providerName:
          providerById.get(config.providerId)?.name ?? config.providerId,
        isActive: config.isActive,
      })),
    };
  }
}
