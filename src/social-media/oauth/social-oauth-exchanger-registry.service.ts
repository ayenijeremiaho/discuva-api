import { Injectable } from '@nestjs/common';
import { SocialPlatform } from '../enum/social-media.enum';
import { SocialOAuthExchanger } from './social-oauth-exchanger.interface';
import { NoExchangerAvailable } from './no-exchanger-available';
import { FacebookOAuthExchanger } from './facebook-oauth-exchanger';
import { InstagramOAuthExchanger } from './instagram-oauth-exchanger';
import { YouTubeOAuthExchanger } from './youtube-oauth-exchanger';

@Injectable()
export class SocialOAuthExchangerRegistry {
  private readonly exchangers: Record<SocialPlatform, SocialOAuthExchanger>;

  constructor(
    noExchangerAvailable: NoExchangerAvailable,
    facebookOAuthExchanger: FacebookOAuthExchanger,
    instagramOAuthExchanger: InstagramOAuthExchanger,
    youtubeOAuthExchanger: YouTubeOAuthExchanger,
  ) {
    this.exchangers = {
      [SocialPlatform.FACEBOOK]: facebookOAuthExchanger,
      [SocialPlatform.INSTAGRAM]: instagramOAuthExchanger,
      [SocialPlatform.X]: noExchangerAvailable,
      [SocialPlatform.YOUTUBE]: youtubeOAuthExchanger,
      [SocialPlatform.TIKTOK]: noExchangerAvailable,
    };
  }

  resolve(platform: SocialPlatform): SocialOAuthExchanger {
    return this.exchangers[platform];
  }
}
