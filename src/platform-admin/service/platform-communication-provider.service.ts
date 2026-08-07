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
