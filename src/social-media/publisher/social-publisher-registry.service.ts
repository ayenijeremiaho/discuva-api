import { Injectable } from '@nestjs/common';
import { SocialPlatform } from '../enum/social-media.enum';
import { SocialPlatformPublisher } from './social-platform-publisher.interface';
import { NotConnectedPublisher } from './not-connected-publisher';
import { PlatformDisabledPublisher } from './platform-disabled-publisher';
import { FacebookGraphPublisher } from './facebook-graph-publisher';
import { InstagramGraphPublisher } from './instagram-graph-publisher';
import { YouTubePublisher } from './youtube-publisher';
import { PlatformSocialAppService } from '../../platform-admin/service/platform-social-app.service';

// Every remaining platform still resolves to NotConnectedPublisher — a
// two-line change per platform (implement SocialPlatformPublisher, swap
// its map entry) with no change to SocialPostService or the controller.
// The platform-admin kill switch (SocialPlatformApp.isActive) is checked
// here, not baked into each publisher, so disabling a platform takes
// effect for every publisher implementation uniformly, present or future.
@Injectable()
export class SocialPublisherRegistry {
  private readonly publishers: Record<SocialPlatform, SocialPlatformPublisher>;

  constructor(
    notConnectedPublisher: NotConnectedPublisher,
    private readonly platformDisabledPublisher: PlatformDisabledPublisher,
    private readonly platformSocialAppService: PlatformSocialAppService,
    facebookGraphPublisher: FacebookGraphPublisher,
    instagramGraphPublisher: InstagramGraphPublisher,
    youtubePublisher: YouTubePublisher,
  ) {
    this.publishers = {
      [SocialPlatform.FACEBOOK]: facebookGraphPublisher,
      [SocialPlatform.INSTAGRAM]: instagramGraphPublisher,
      [SocialPlatform.X]: notConnectedPublisher,
      [SocialPlatform.YOUTUBE]: youtubePublisher,
      [SocialPlatform.TIKTOK]: notConnectedPublisher,
    };
  }

  async resolve(platform: SocialPlatform): Promise<SocialPlatformPublisher> {
    if (await this.platformSocialAppService.isPlatformDisabled(platform)) {
      return this.platformDisabledPublisher;
    }
    return this.publishers[platform];
  }
}
