import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { YoutubeIntegrationState } from '../entity/youtube-integration-state.entity';
import { AnnouncementService } from '../../../announcement/service/announcement.service';
import { CacheService } from '../../../utility/service/cache.service';

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
    private readonly configService: ConfigService,
    @InjectRepository(YoutubeIntegrationState)
    private readonly stateRepo: Repository<YoutubeIntegrationState>,
    private readonly announcementService: AnnouncementService,
    private readonly cacheService: CacheService,
  ) {}

  // Called from the WebSub callback with the video id parsed out of the
  // Atom feed notification. Never throws — the webhook handler must always
  // ack quickly regardless of what happens here.
  async handleNotification(videoId: string | null): Promise<void> {
    if (!videoId) return;

    const channelId = this.configService.get<string>('YOUTUBE_CHANNEL_ID');
    const apiKey = this.configService.get<string>('YOUTUBE_API_KEY');
    if (!channelId || !apiKey) return;

    // WebSub hubs routinely redeliver the same notification; without this,
    // two concurrent deliveries can both pass the lastAnnouncedVideoId check
    // below before either write lands, double-announcing the same stream.
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
      let state = await this.stateRepo.findOne({ where: { channelId } });
      if (state?.lastAnnouncedVideoId === videoId) return;

      const snippet = await this.fetchSnippet(videoId, apiKey);
      if (!snippet || snippet.liveBroadcastContent !== 'live') return;
      // The notification only carries a video id, not which channel it came
      // from — without this check, any currently-live video id (reachable
      // via the public webhook once past signature verification) would
      // trigger a "we're live" push, not just this channel's own streams.
      if (snippet.channelId !== channelId) {
        this.logger.warn(
          `Ignored live video ${videoId} — channel ${snippet.channelId} does not match configured channel ${channelId}`,
        );
        return;
      }

      const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
      await this.announcementService.createSystemAnnouncement(
        `🔴 Live Now: ${snippet.title ?? 'Service'}`,
        `We're live now — tap to watch.\n\n${watchUrl}`,
      );

      if (!state) {
        state = this.stateRepo.create({
          channelId,
          lastAnnouncedVideoId: videoId,
        });
      } else {
        state.lastAnnouncedVideoId = videoId;
      }
      await this.stateRepo.save(state);
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
