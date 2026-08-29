import { Injectable } from '@nestjs/common';
import { SocialPlatformApp } from '../../platform-admin/entity/social-platform-app.entity';
import { YouTubeApiService } from '../platform/youtube/youtube-api.service';
import {
  OAuthExchangeResult,
  SocialOAuthExchanger,
} from './social-oauth-exchanger.interface';

@Injectable()
export class YouTubeOAuthExchanger implements SocialOAuthExchanger {
  constructor(private readonly youtubeApi: YouTubeApiService) {}

  buildAuthorizeUrl(app: SocialPlatformApp, state: string): string {
    return this.youtubeApi.buildAuthorizeUrl(app, state);
  }

  async exchangeCode(
    code: string,
    app: SocialPlatformApp,
    clientSecret: string,
  ): Promise<OAuthExchangeResult> {
    const tokens = await this.youtubeApi.exchangeCode(code, app, clientSecret);
    const channel = await this.youtubeApi.resolveChannel(tokens.accessToken);
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInSeconds: tokens.expiresInSeconds,
      externalAccountId: channel.channelId,
      scope: app.scopes,
    };
  }
}
