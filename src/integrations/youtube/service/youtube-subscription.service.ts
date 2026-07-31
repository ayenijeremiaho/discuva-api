import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { YoutubeIntegrationState } from '../entity/youtube-integration-state.entity';

const PUBSUBHUBBUB_URL = 'https://pubsubhubbub.appspot.com/subscribe';
// The hub's own lease is typically 5-10 days; re-subscribing daily (see
// YoutubeSubscriptionScheduler) keeps this comfortably ahead of expiry
// regardless of what the hub actually grants.
const ASSUMED_LEASE_DAYS = 5;

@Injectable()
export class YoutubeSubscriptionService implements OnModuleInit {
  private readonly logger = new Logger(YoutubeSubscriptionService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(YoutubeIntegrationState)
    private readonly stateRepo: Repository<YoutubeIntegrationState>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.subscribe();
  }

  isConfigured(): boolean {
    return !!(
      this.configService.get<string>('YOUTUBE_CHANNEL_ID') &&
      this.configService.get<string>('YOUTUBE_WEBSUB_CALLBACK_URL') &&
      this.configService.get<string>('YOUTUBE_WEBSUB_SECRET')
    );
  }

  async subscribe(): Promise<void> {
    if (!this.isConfigured()) {
      this.logger.debug(
        'YouTube live detection not configured — skipping WebSub subscription',
      );
      return;
    }

    const channelId = this.configService.get<string>('YOUTUBE_CHANNEL_ID')!;
    const callbackUrl = this.configService.get<string>(
      'YOUTUBE_WEBSUB_CALLBACK_URL',
    )!;
    const secret = this.configService.get<string>('YOUTUBE_WEBSUB_SECRET')!;
    const topic = `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}`;

    try {
      const body = new URLSearchParams({
        'hub.callback': callbackUrl,
        'hub.topic': topic,
        'hub.verify': 'async',
        'hub.mode': 'subscribe',
        'hub.lease_seconds': String(ASSUMED_LEASE_DAYS * 86_400),
        'hub.secret': secret,
      });

      const response = await fetch(PUBSUBHUBBUB_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!response.ok) {
        this.logger.warn(
          `WebSub subscription request rejected (${response.status}) for channel ${channelId}`,
        );
        return;
      }

      let state = await this.stateRepo.findOne({ where: { channelId } });
      const subscriptionExpiresAt = new Date(
        Date.now() + ASSUMED_LEASE_DAYS * 86_400_000,
      );
      if (!state) {
        state = this.stateRepo.create({ channelId, subscriptionExpiresAt });
      } else {
        state.subscriptionExpiresAt = subscriptionExpiresAt;
      }
      await this.stateRepo.save(state);
      this.logger.log(`WebSub subscription requested for channel ${channelId}`);
    } catch (err: any) {
      this.logger.warn(
        `Failed to request WebSub subscription: ${err?.message ?? err}`,
      );
    }
  }
}
