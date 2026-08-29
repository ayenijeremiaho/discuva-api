import { Injectable, Logger } from '@nestjs/common';
import { SocialAccount } from '../entity/social-account.entity';
import { SocialPostMedia } from '../entity/social-post-media.entity';
import { SocialPlacement } from '../enum/social-media.enum';
import { SocialTokenResolverService } from '../service/social-token-resolver.service';
import { MetaGraphApiService } from '../platform/meta/meta-graph-api.service';
import {
  PublishResult,
  SocialPlatformPublisher,
} from './social-platform-publisher.interface';

// FEED, STORY, and REEL are all implemented — see
// MetaGraphApiService.publishToInstagram for how each maps to a Graph API
// media_type.
//
// SocialPostService.publish() calls publisher.publish() with no
// try/catch — every failure path below must resolve to
// { success: false, error }, never throw.
@Injectable()
export class InstagramGraphPublisher implements SocialPlatformPublisher {
  private readonly logger = new Logger(InstagramGraphPublisher.name);

  constructor(
    private readonly tokenResolver: SocialTokenResolverService,
    private readonly graphApi: MetaGraphApiService,
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
          'This Instagram account is connected but has no Business Account id on record — reconnect it.',
      };
    }
    try {
      const accessToken = await this.tokenResolver.getValidAccessToken(
        account.id,
      );
      const externalPostId = await this.graphApi.publishToInstagram(
        account.externalAccountId,
        accessToken,
        content,
        media,
        placement,
      );
      return { success: true, externalPostId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Instagram publish failed for account ${account.id}: ${message}`,
      );
      return { success: false, error: message };
    }
  }
}
