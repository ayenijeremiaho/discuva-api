import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { TenantYoutubeIntegration } from '../entity/tenant-youtube-integration.entity';
import { Tenant } from '../../../tenant/entity/tenant.entity';
import { AnnouncementService } from '../../../announcement/service/announcement.service';
import { CacheService } from '../../../utility/service/cache.service';
import { EncryptionService } from '../../../utility/service/encryption.service';
import { AppClsStore } from '../../../tenant/interface/tenant-cls-store.interface';

interface YoutubeVideosListResponse {
  items?: {
    snippet?: {
      title?: string;
      liveBroadcastContent?: string;
      channelId?: string;
    };
  }[];
}

const NOTIFICATION_LOCK_TTL_SECONDS = 60;

@Injectable()
export class YoutubeLiveDetectionService {
  private readonly logger = new Logger(YoutubeLiveDetectionService.name);

  constructor(
    @InjectRepository(TenantYoutubeIntegration)
    private readonly integrationRepo: Repository<TenantYoutubeIntegration>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly announcementService: AnnouncementService,
    private readonly cacheService: CacheService,
    private readonly encryptionService: EncryptionService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  // Called from the WebSub callback with both fields parsed out of the Atom
  // feed notification body. Never throws — the webhook handler must always
  // ack quickly regardless of what happens here. channelId is what makes
  // this tenant-resolvable at all: the notification itself carries no Host
  // header or anything else that would let TenantMiddleware do this for us
  // (and this route is deliberately excluded from it — see
  // TenantModule's exclude list).
  async handleNotification(
    videoId: string | null,
    channelId: string | null,
  ): Promise<void> {
    if (!videoId || !channelId) return;

    const lockKey = `lock:youtube-notification:${videoId}`;
    const acquired = await this.cacheService.acquireLock(
      lockKey,
      NOTIFICATION_LOCK_TTL_SECONDS,
    );
    if (!acquired) {
      this.logger.debug(
        `Skipped duplicate/concurrent YouTube notification for video ${videoId}`,
      );
      return;
    }

    try {
      const integration = await this.integrationRepo.findOne({
        where: { channelId, isActive: true },
        select: {
          id: true,
          tenantId: true,
          channelId: true,
          apiKeyEncrypted: true,
          lastAnnouncedVideoId: true,
        },
      });
      if (!integration) {
        this.logger.debug(
          `Ignored YouTube notification for channel ${channelId} — no active tenant integration`,
        );
        return;
      }
      if (integration.lastAnnouncedVideoId === videoId) return;

      // No platform-wide fallback — a tenant who hasn't set their own key
      // just doesn't get live-detection, silently, rather than quietly
      // borrowing shared platform quota they never asked to use.
      if (!integration.apiKeyEncrypted) {
        this.logger.debug(
          `No tenant API key configured for channel ${channelId} — skipping live-detection lookup.`,
        );
        return;
      }
      const apiKey = this.encryptionService.decrypt(
        integration.apiKeyEncrypted,
      );

      const snippet = await this.fetchSnippet(videoId, apiKey);
      if (!snippet || snippet.liveBroadcastContent !== 'live') return;
      // The notification only carries a video id, not which channel it came
      // from at the Data API layer — without this check, any currently-live
      // video id (reachable via the public webhook once past signature
      // verification) would trigger a "we're live" push for the wrong tenant.
      if (snippet.channelId !== channelId) {
        this.logger.warn(
          `Ignored live video ${videoId} — channel ${snippet.channelId} does not match notified channel ${channelId}`,
        );
        return;
      }

      const tenant = await this.tenantRepo.findOneBy({
        id: integration.tenantId,
      });
      if (!tenant) return; // tenant deleted/deactivated since the integration row was created

      const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
      await this.cls.runWith(
        { tenantId: tenant.id, schemaName: tenant.schemaName } as AppClsStore,
        () =>
          this.txHost.withTransaction(async () => {
            await this.txHost.tx.query(
              `SET LOCAL search_path TO "${tenant.schemaName}", public`,
            );
            await this.announcementService.createSystemAnnouncement(
              `🔴 Live Now: ${snippet.title ?? 'Service'}`,
              `We're live now — tap to watch.\n\n${watchUrl}`,
            );
          }),
      );

      integration.lastAnnouncedVideoId = videoId;
      await this.integrationRepo.save(integration);
    } catch (err: any) {
      this.logger.warn(
        `Failed to process YouTube notification for video ${videoId}: ${err?.message ?? err}`,
      );
    } finally {
      this.cacheService.releaseLock(lockKey);
    }
  }

  private async fetchSnippet(
    videoId: string,
    apiKey: string,
  ): Promise<{
    title?: string;
    liveBroadcastContent?: string;
    channelId?: string;
  } | null> {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) {
      this.logger.warn(
        `YouTube Data API request failed (${response.status}) for video ${videoId}`,
      );
      return null;
    }
    const data = (await response.json()) as YoutubeVideosListResponse;
    return data.items?.[0]?.snippet ?? null;
  }
}
