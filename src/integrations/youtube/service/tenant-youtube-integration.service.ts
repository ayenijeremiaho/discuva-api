import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TenantYoutubeIntegration } from '../entity/tenant-youtube-integration.entity';
import { EncryptionService } from '../../../utility/service/encryption.service';
import { AppClsStore } from '../../../tenant/interface/tenant-cls-store.interface';
import { UpsertYoutubeIntegrationDto } from '../dto/upsert-youtube-integration.dto';
import { YoutubeSubscriptionService } from './youtube-subscription.service';

export interface TenantYoutubeIntegrationSummary {
  channelId: string;
  hasOwnApiKey: boolean;
  isActive: boolean;
  subscriptionExpiresAt: Date | null;
}

// Tenant self-service equivalent of TenantCommunicationProviderService —
// same shape (AdminGuard, encrypted BYOK credential, never returned
// verbatim) — but YouTube's own resource per tenant is a single row, not
// one-per-provider-per-channel, so no :channel route param is needed here.
@Injectable()
export class TenantYoutubeIntegrationService {
  constructor(
    private readonly cls: ClsService<AppClsStore>,
    private readonly encryptionService: EncryptionService,
    private readonly subscriptionService: YoutubeSubscriptionService,
    @InjectRepository(TenantYoutubeIntegration)
    private readonly integrationRepo: Repository<TenantYoutubeIntegration>,
  ) {}

  private currentTenantId(): string {
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) {
      throw new ForbiddenException('No tenant context for this request.');
    }
    return tenantId;
  }

  private toSummary(
    integration: TenantYoutubeIntegration,
  ): TenantYoutubeIntegrationSummary {
    return {
      channelId: integration.channelId,
      hasOwnApiKey: !!integration.apiKeyEncrypted,
      isActive: integration.isActive,
      subscriptionExpiresAt: integration.subscriptionExpiresAt,
    };
  }

  async get(): Promise<TenantYoutubeIntegrationSummary | null> {
    const tenantId = this.currentTenantId();
    const integration = await this.integrationRepo.findOne({
      where: { tenantId },
      select: {
        channelId: true,
        apiKeyEncrypted: true,
        isActive: true,
        subscriptionExpiresAt: true,
      },
    });
    return integration ? this.toSummary(integration) : null;
  }

  async upsert(
    dto: UpsertYoutubeIntegrationDto,
  ): Promise<TenantYoutubeIntegrationSummary> {
    const tenantId = this.currentTenantId();

    const existingForChannel = await this.integrationRepo.findOne({
      where: { channelId: dto.channelId },
    });
    if (existingForChannel && existingForChannel.tenantId !== tenantId) {
      throw new ConflictException(
        'This YouTube channel is already registered to a different tenant.',
      );
    }

    let integration = await this.integrationRepo.findOne({
      where: { tenantId },
    });
    const previousChannelId = integration?.channelId;

    if (!integration) {
      integration = this.integrationRepo.create({ tenantId });
    }
    integration.channelId = dto.channelId;
    integration.apiKeyEncrypted = dto.apiKey
      ? this.encryptionService.encrypt(dto.apiKey)
      : null;
    integration.isActive = true;
    await this.integrationRepo.save(integration);

    // Switching to a different channel — stop listening on the old one
    // before starting the new one, so the tenant isn't left subscribed to
    // (and occasionally announcing from) a channel they no longer own.
    if (previousChannelId && previousChannelId !== dto.channelId) {
      await this.subscriptionService.unsubscribe(previousChannelId);
    }
    await this.subscriptionService.subscribe(dto.channelId);

    return this.toSummary(integration);
  }

  async setActive(isActive: boolean): Promise<TenantYoutubeIntegrationSummary> {
    const tenantId = this.currentTenantId();
    const integration = await this.integrationRepo.findOne({
      where: { tenantId },
      // `id` has to be selected here (unlike get()'s identical-looking
      // select, which is read-only) — save() below needs the primary key
      // present to recognize this as an UPDATE. Without it, TypeORM treats
      // the entity as new and attempts an INSERT with tenant_id NULL,
      // failing the not-null constraint on every real call.
      select: {
        id: true,
        channelId: true,
        apiKeyEncrypted: true,
        isActive: true,
        subscriptionExpiresAt: true,
      },
    });
    if (!integration) {
      throw new NotFoundException(
        'No YouTube integration configured yet — set a channel before enabling.',
      );
    }
    integration.isActive = isActive;
    await this.integrationRepo.save(integration);

    if (isActive) {
      await this.subscriptionService.subscribe(integration.channelId);
    } else {
      await this.subscriptionService.unsubscribe(integration.channelId);
    }

    return this.toSummary(integration);
  }
}
