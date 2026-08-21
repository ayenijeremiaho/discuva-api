import { Injectable } from '@nestjs/common';
import { SocialPlatform } from '../enum/social-media.enum';
import { SocialPlatformPublisher } from './social-platform-publisher.interface';
import { NotConnectedPublisher } from './not-connected-publisher';
import { PlatformDisabledPublisher } from './platform-disabled-publisher';
import { PlatformSocialAppService } from '../../platform-admin/service/platform-social-app.service';

// Every real platform still resolves to NotConnectedPublisher today — a two-
// line change per platform (implement SocialPlatformPublisher, swap its map
// entry) with no change to SocialPostService or the controller. The
// platform-admin kill switch (SocialPlatformApp.isActive) is checked here,
// not baked into each publisher, so disabling a platform takes effect for
// every publisher implementation uniformly, present or future.
@Injectable()
export class SocialPublisherRegistry {
  private readonly publishers: Record<SocialPlatform, SocialPlatformPublisher>;

  constructor(
    notConnectedPublisher: NotConnectedPublisher,
    private readonly platformDisabledPublisher: PlatformDisabledPublisher,
    private readonly platformSocialAppService: PlatformSocialAppService,
  ) {
    this.publishers = {
      [SocialPlatform.FACEBOOK]: notConnectedPublisher,
      [SocialPlatform.INSTAGRAM]: notConnectedPublisher,
      [SocialPlatform.X]: notConnectedPublisher,
      [SocialPlatform.YOUTUBE]: notConnectedPublisher,
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
