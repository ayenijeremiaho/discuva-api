import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantYoutubeIntegration } from '../entity/tenant-youtube-integration.entity';

// The hub's own lease is typically 5-10 days; re-subscribing daily (see
// YoutubeSubscriptionScheduler) keeps this comfortably ahead of expiry
// regardless of what the hub actually grants.
const ASSUMED_LEASE_DAYS = 5;

// Talks to Google's PubSubHubbub hub for one channel at a time — knows
// nothing about tenants itself, just "subscribe/unsubscribe this channel
// id". Callers (TenantYoutubeIntegrationService on configure/disable,
// YoutubeSubscriptionScheduler on renewal) own deciding *which* channel and
// *when*. Previously subscribed to a single global YOUTUBE_CHANNEL_ID once
// at app boot — now per-channel, on demand, for as many tenants as have
// configured their own.
@Injectable()
export class YoutubeSubscriptionService {
  private readonly logger = new Logger(YoutubeSubscriptionService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(TenantYoutubeIntegration)
    private readonly integrationRepo: Repository<TenantYoutubeIntegration>,
  ) {}

  // Platform-level WebSub infra (callback URL + HMAC secret) — these stay
  // platform-wide on purpose, not BYOK: the callback URL is one fixed HTTP
  // endpoint this server exposes regardless of which tenant a notification
  // turns out to be for, and the secret is just an anti-forgery HMAC key,
  // not a credential that grants access to anything tenant-specific.
  isWebSubConfigured(): boolean {
    return !!(
      this.configService.get<string>('YOUTUBE_WEBSUB_CALLBACK_URL') &&
      this.configService.get<string>('YOUTUBE_WEBSUB_SECRET')
    );
  }

  async subscribe(channelId: string): Promise<void> {
    if (!this.isWebSubConfigured()) {
      this.logger.debug(
        `YouTube WebSub not configured at the platform level — skipping subscription for channel ${channelId}`,
      );
      return;
    }
    await this.sendHubRequest(channelId, 'subscribe');
  }

  async unsubscribe(channelId: string): Promise<void> {
    if (!this.isWebSubConfigured()) return;
    await this.sendHubRequest(channelId, 'unsubscribe');
  }

  // Renews every currently-active tenant's subscription — called daily by
  // YoutubeSubscriptionScheduler. Each channel is independent: one failing
  // (network blip, a since-deleted channel) doesn't block the rest.
  async renewAllActive(): Promise<void> {
    if (!this.isWebSubConfigured()) return;
    const active = await this.integrationRepo.find({
      where: { isActive: true },
    });
    for (const integration of active) {
      await this.subscribe(integration.channelId);
    }
  }

  private async sendHubRequest(
    channelId: string,
    mode: 'subscribe' | 'unsubscribe',
  ): Promise<void> {
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
        'hub.mode': mode,
        'hub.lease_seconds': String(ASSUMED_LEASE_DAYS * 86_400),
        'hub.secret': secret,
      });

      const hubUrl = this.configService.get<string>(
        'PUBSUBHUBBUB_URL',
        'https://pubsubhubbub.appspot.com/subscribe',
      );
      const response = await fetch(hubUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!response.ok) {
        this.logger.warn(
          `WebSub ${mode} request rejected (${response.status}) for channel ${channelId}`,
        );
        return;
      }

      const integration = await this.integrationRepo.findOne({
        where: { channelId },
      });
      if (!integration) return;
      integration.subscriptionExpiresAt =
        mode === 'subscribe'
          ? new Date(Date.now() + ASSUMED_LEASE_DAYS * 86_400_000)
          : null;
      await this.integrationRepo.save(integration);
      this.logger.log(`WebSub ${mode} requested for channel ${channelId}`);
    } catch (err: any) {
      this.logger.warn(
        `Failed to request WebSub ${mode}: ${err?.message ?? err}`,
      );
    }
  }
}
