import {
  BadRequestException,
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

import {
  CheckedChannel,
  YoutubeChannelCheckService,
} from './youtube-channel-check.service';

// ANNOUNCING: live streams are announced. NEEDS_API_KEY: nothing is announced until the church adds its key.
export type YoutubeIntegrationStatus =
  'ANNOUNCING' | 'NEEDS_API_KEY' | 'PAUSED';

export interface TenantYoutubeIntegrationSummary {
  channelId: string;
  channelTitle: string | null;
  hasOwnApiKey: boolean;
  isActive: boolean;
  status: YoutubeIntegrationStatus;
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
    private readonly channelCheck: YoutubeChannelCheckService,
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
    let status: YoutubeIntegrationStatus = 'ANNOUNCING';
    if (!integration.apiKeyEncrypted) status = 'NEEDS_API_KEY';
    else if (!integration.isActive) status = 'PAUSED';
    return {
      channelId: integration.channelId,
      channelTitle: integration.channelTitle ?? null,
      hasOwnApiKey: !!integration.apiKeyEncrypted,
      isActive: integration.isActive,
      status,
      subscriptionExpiresAt: integration.subscriptionExpiresAt,
    };
  }

  async get(): Promise<TenantYoutubeIntegrationSummary | null> {
    const tenantId = this.currentTenantId();
    const integration = await this.integrationRepo.findOne({
      where: { tenantId },
      select: {
        channelId: true,
        channelTitle: true,
        apiKeyEncrypted: true,
        isActive: true,
        subscriptionExpiresAt: true,
      },
    });
    return integration ? this.toSummary(integration) : null;
  }

  // The key to use: the one just typed, or the one already saved (blank keeps it).
  private async keyFor(
    tenantId: string,
    typed?: string,
  ): Promise<{ key: string; saved: TenantYoutubeIntegration | null }> {
    const saved = await this.integrationRepo.findOne({
      where: { tenantId },
      select: {
        id: true,
        tenantId: true,
        channelId: true,
        channelTitle: true,
        apiKeyEncrypted: true,
        isActive: true,
        subscriptionExpiresAt: true,
      },
    });
    const key =
      typed?.trim() ||
      (saved?.apiKeyEncrypted
        ? this.encryptionService.decrypt(saved.apiKeyEncrypted)
        : '');
    if (!key)
      throw new BadRequestException(
        'Add your YouTube API key. Live streams are only announced with your own key.',
      );
    return { key, saved };
  }

  // Checks the channel and key with YouTube without saving anything.
  async test(dto: UpsertYoutubeIntegrationDto): Promise<CheckedChannel> {
    const { key } = await this.keyFor(this.currentTenantId(), dto.apiKey);
    return this.channelCheck.check(dto.channelId, key);
  }

  async upsert(
    dto: UpsertYoutubeIntegrationDto,
  ): Promise<TenantYoutubeIntegrationSummary> {
    const tenantId = this.currentTenantId();
    const { key, saved } = await this.keyFor(tenantId, dto.apiKey);
    const channel = await this.channelCheck.check(dto.channelId, key);

    const existingForChannel = await this.integrationRepo.findOne({
      where: { channelId: channel.channelId },
    });
    if (existingForChannel && existingForChannel.tenantId !== tenantId) {
      throw new ConflictException(
        'This YouTube channel is already registered to a different tenant.',
      );
    }

    const integration = saved ?? this.integrationRepo.create({ tenantId });
    const previousChannelId = saved?.channelId;
    integration.channelId = channel.channelId;
    integration.channelTitle = channel.channelTitle;
    // Only a newly typed key replaces the saved one; a blank field keeps it.
    if (dto.apiKey?.trim())
      integration.apiKeyEncrypted = this.encryptionService.encrypt(
        dto.apiKey.trim(),
      );
    integration.isActive = true;
    await this.integrationRepo.save(integration);

    // Switching to a different channel — stop listening on the old one
    // before starting the new one, so the tenant isn't left subscribed to
    // (and occasionally announcing from) a channel they no longer own.
    if (previousChannelId && previousChannelId !== channel.channelId) {
      await this.subscriptionService.unsubscribe(previousChannelId);
    }
    await this.subscriptionService.subscribe(channel.channelId);

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
        channelTitle: true,
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
