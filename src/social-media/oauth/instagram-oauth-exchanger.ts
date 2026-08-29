import { Injectable } from '@nestjs/common';
import { SocialPlatformApp } from '../../platform-admin/entity/social-platform-app.entity';
import { MetaGraphApiService } from '../platform/meta/meta-graph-api.service';
import {
  OAuthExchangeResult,
  SocialOAuthExchanger,
} from './social-oauth-exchanger.interface';

// Instagram Business publishing authenticates with the linked Facebook
// Page's access token, not a token scoped to Instagram itself — the only
// thing that differs from FacebookOAuthExchanger is which id ends up as
// externalAccountId: the IG Business Account, resolved via one extra call
// once the Page is known.
@Injectable()
export class InstagramOAuthExchanger implements SocialOAuthExchanger {
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
    const igUserId = await this.graphApi.getInstagramBusinessAccountId(
      page.pageId,
      page.pageAccessToken,
    );
    return {
      accessToken: page.pageAccessToken,
      externalAccountId: igUserId,
      scope: app.scopes,
    };
  }
}
