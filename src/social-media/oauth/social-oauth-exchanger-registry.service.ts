import { Injectable } from '@nestjs/common';
import { SocialPlatform } from '../enum/social-media.enum';
import { SocialOAuthExchanger } from './social-oauth-exchanger.interface';
import { NoExchangerAvailable } from './no-exchanger-available';

@Injectable()
export class SocialOAuthExchangerRegistry {
  private readonly exchangers: Record<SocialPlatform, SocialOAuthExchanger>;

  constructor(noExchangerAvailable: NoExchangerAvailable) {
    this.exchangers = {
      [SocialPlatform.FACEBOOK]: noExchangerAvailable,
      [SocialPlatform.INSTAGRAM]: noExchangerAvailable,
      [SocialPlatform.X]: noExchangerAvailable,
      [SocialPlatform.YOUTUBE]: noExchangerAvailable,
      [SocialPlatform.TIKTOK]: noExchangerAvailable,
    };
  }

  resolve(platform: SocialPlatform): SocialOAuthExchanger {
    return this.exchangers[platform];
  }
}
