import { Injectable } from '@nestjs/common';
import { SocialPlatform } from '../enum/social-media.enum';
import { SocialTokenRefresher } from './social-token-refresher.interface';
import { NoRefresherAvailable } from './no-refresher-available';
import { YouTubeTokenRefresher } from './youtube-token-refresher';

@Injectable()
export class SocialTokenRefresherRegistry {
  private readonly refreshers: Record<SocialPlatform, SocialTokenRefresher>;

  constructor(
    noRefresherAvailable: NoRefresherAvailable,
    youtubeTokenRefresher: YouTubeTokenRefresher,
  ) {
    this.refreshers = {
      [SocialPlatform.FACEBOOK]: noRefresherAvailable,
      [SocialPlatform.INSTAGRAM]: noRefresherAvailable,
      [SocialPlatform.X]: noRefresherAvailable,
      [SocialPlatform.YOUTUBE]: youtubeTokenRefresher,
      [SocialPlatform.TIKTOK]: noRefresherAvailable,
    };
  }

  resolve(platform: SocialPlatform): SocialTokenRefresher {
    return this.refreshers[platform];
  }
}
