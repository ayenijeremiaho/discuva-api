import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { GivingProvider } from '../../giving-checkout/entity/giving-provider.entity';
import { TenantGivingProviderConfig } from '../../giving-checkout/entity/tenant-giving-provider-config.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';

export interface TenantGivingProviderSummary {
  providerId: string;
  providerName: string;
  isActive: boolean;
}

// Platform-admin-only support lookup — mirrors
// PlatformCommunicationProviderService.getTenantProviders(), just for
// giving-checkout instead of SMS/email. Never returns credentials —
// TenantGivingProviderConfig.credentialsEncrypted has `select: false` and
// this never selects it back in.
@Injectable()
export class PlatformGivingProviderService {
  constructor(
    @InjectRepository(GivingProvider)
    private readonly providerRepo: Repository<GivingProvider>,
    @InjectRepository(TenantGivingProviderConfig)
    private readonly configRepo: Repository<TenantGivingProviderConfig>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

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
