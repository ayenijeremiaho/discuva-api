import { Injectable, Logger } from '@nestjs/common';
import { SocialAccount } from '../entity/social-account.entity';
import { SocialPostMedia } from '../entity/social-post-media.entity';
import { SocialPlacement } from '../enum/social-media.enum';
import { SocialTokenResolverService } from '../service/social-token-resolver.service';
import { YouTubeApiService } from '../platform/youtube/youtube-api.service';
import {
  PublishResult,
  SocialPlatformPublisher,
} from './social-platform-publisher.interface';

// FEED and REEL (Shorts) both implemented — see YouTubeApiService's own
// comment on how a REEL placement gets flagged for Shorts. STORY isn't a
// YouTube concept; a target validated as STORY would reach here and fail
// honestly (no video-only "story" upload path exists for this platform),
// but SocialMediaValidationService's constraints table never defines
// YOUTUBE/STORY, so that isn't reachable today.
//
// SocialPostService.publish() calls publisher.publish() with no
// try/catch — every failure path below must resolve to
// { success: false, error }, never throw.
@Injectable()
export class YouTubePublisher implements SocialPlatformPublisher {
  private readonly logger = new Logger(YouTubePublisher.name);

  constructor(
    private readonly tokenResolver: SocialTokenResolverService,
    private readonly youtubeApi: YouTubeApiService,
  ) {}

  async publish(
    account: SocialAccount,
    content: string,
    media: SocialPostMedia[],
    placement: SocialPlacement,
  ): Promise<PublishResult> {
    if (!account.externalAccountId) {
      return {
        success: false,
        error:
          'This YouTube channel is connected but has no channel id on record — reconnect it.',
      };
    }
    try {
      const accessToken = await this.tokenResolver.getValidAccessToken(
        account.id,
      );
      const externalPostId = await this.youtubeApi.publishVideo(
        accessToken,
        content,
        media,
        placement,
      );
      return { success: true, externalPostId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `YouTube publish failed for account ${account.id}: ${message}`,
      );
      return { success: false, error: message };
    }
  }
}
