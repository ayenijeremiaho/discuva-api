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

// Only FEED is implemented — MetaGraphApiService.publishToFacebookPage
// rejects any other placement explicitly rather than silently treating it
// as FEED. Facebook only validates FEED today (see
// SocialMediaValidationService's CONSTRAINTS table) so this isn't
// reachable in practice yet, but the rejection is real, not assumed.
//
// SocialPostService.publish() calls publisher.publish() with no
// try/catch — every failure path below must resolve to
// { success: false, error }, never throw, or one platform failing would
// abort every other target's publish attempt too.
@Injectable()
export class FacebookGraphPublisher implements SocialPlatformPublisher {
  private readonly logger = new Logger(FacebookGraphPublisher.name);

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
          'This Facebook Page is connected but has no Page id on record — reconnect it.',
      };
    }
    try {
      const accessToken = await this.tokenResolver.getValidAccessToken(
        account.id,
      );
      const externalPostId = await this.graphApi.publishToFacebookPage(
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
        `Facebook publish failed for account ${account.id}: ${message}`,
      );
      return { success: false, error: message };
    }
  }
}
