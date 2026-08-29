import { Injectable } from '@nestjs/common';
import { SocialPlatformApp } from '../../platform-admin/entity/social-platform-app.entity';
import { MetaGraphApiService } from '../platform/meta/meta-graph-api.service';
import {
  OAuthExchangeResult,
  SocialOAuthExchanger,
} from './social-oauth-exchanger.interface';

// No refreshToken/expiresInSeconds: a Page access token obtained via a
// long-lived user token doesn't expire in practice, and Meta issues no
// refresh_token for it — SocialTokenResolverService treats a null
// tokenExpiresAt as "never needs refreshing," which is the honest state
// here (see NoRefresherAvailable, still registered for FACEBOOK/INSTAGRAM).
@Injectable()
export class FacebookOAuthExchanger implements SocialOAuthExchanger {
  constructor(private readonly graphApi: MetaGraphApiService) {}

  buildAuthorizeUrl(app: SocialPlatformApp, state: string): string {
    return this.graphApi.buildAuthorizeUrl(app, state);
  }

  async exchangeCode(
    code: string,
    app: SocialPlatformApp,
    clientSecret: string,
  ): Promise<OAuthExchangeResult> {
    const page = await this.graphApi.resolvePageAccessToken(
      code,
      app,
      clientSecret,
    );
    return {
      accessToken: page.pageAccessToken,
      externalAccountId: page.pageId,
      scope: app.scopes,
    };
  }
}
