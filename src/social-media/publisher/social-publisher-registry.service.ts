import { Injectable } from '@nestjs/common';
import { SocialPlatform } from '../enum/social-media.enum';
import { SocialPlatformPublisher } from './social-platform-publisher.interface';
import { NotConnectedPublisher } from './not-connected-publisher';

// Every platform resolves to NotConnectedPublisher today. Wiring in a real
// integration later is a two-line change here — implement
// SocialPlatformPublisher for that platform and swap its map entry — with
// no change to SocialPostService or the controller.
@Injectable()
export class SocialPublisherRegistry {
  private readonly publishers: Record<SocialPlatform, SocialPlatformPublisher>;

  constructor(notConnectedPublisher: NotConnectedPublisher) {
    this.publishers = {
      [SocialPlatform.FACEBOOK]: notConnectedPublisher,
      [SocialPlatform.INSTAGRAM]: notConnectedPublisher,
      [SocialPlatform.X]: notConnectedPublisher,
      [SocialPlatform.YOUTUBE]: notConnectedPublisher,
      [SocialPlatform.TIKTOK]: notConnectedPublisher,
    };
  }

  resolve(platform: SocialPlatform): SocialPlatformPublisher {
    return this.publishers[platform];
  }
}
