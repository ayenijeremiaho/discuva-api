import { Injectable } from '@nestjs/common';
import {
  OAuthExchangeResult,
  SocialOAuthExchanger,
} from './social-oauth-exchanger.interface';

// The default for every platform until a real OAuth exchanger is
// registered alongside its SocialPlatformPublisher/SocialTokenRefresher.
@Injectable()
export class NoExchangerAvailable implements SocialOAuthExchanger {
  buildAuthorizeUrl(): string {
    throw new Error(
      'OAuth is not yet implemented for this platform — cannot build an authorize URL.',
    );
  }

  async exchangeCode(): Promise<OAuthExchangeResult> {
    throw new Error(
      'OAuth is not yet implemented for this platform — cannot exchange the authorization code.',
    );
  }
}
