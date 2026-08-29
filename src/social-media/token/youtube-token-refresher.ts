import { Injectable } from '@nestjs/common';
import { PlatformSocialAppService } from '../../platform-admin/service/platform-social-app.service';
import { YouTubeApiService } from '../platform/youtube/youtube-api.service';
import { SocialPlatform } from '../enum/social-media.enum';
import {
  RefreshResult,
  SocialTokenRefresher,
} from './social-token-refresher.interface';

// The one platform (of the three implemented so far) that actually needs
// this — a Meta Page token doesn't expire, but a Google access token does
// (~1 hour), so SocialTokenResolverService leans on this every time a
// stored YouTube token has aged out.
//
// SocialTokenRefresher.refresh() only receives the bare refresh token, not
// the platform app/clientSecret a Google token refresh request needs — so
// this looks its own app credentials up directly (it's already
// irreducibly YouTube-specific by being this class at all) rather than
// requiring an interface change that every other platform would have to
// accommodate too.
@Injectable()
export class YouTubeTokenRefresher implements SocialTokenRefresher {
  constructor(
    private readonly platformSocialAppService: PlatformSocialAppService,
    private readonly youtubeApi: YouTubeApiService,
  ) {}

  async refresh(refreshToken: string): Promise<RefreshResult> {
    const resolved = await this.platformSocialAppService.getDecryptedApp(
      SocialPlatform.YOUTUBE,
    );
    if (!resolved) {
      throw new Error(
        'YouTube platform app is not registered — cannot refresh the access token.',
      );
    }
    const tokens = await this.youtubeApi.refreshAccessToken(
      refreshToken,
      resolved.app,
      resolved.clientSecret,
    );
    return {
      accessToken: tokens.accessToken,
      // Google doesn't rotate the refresh token on a refresh grant —
      // omitted (undefined) when absent so SocialTokenResolverService
      // keeps using the existing one, per RefreshResult's own contract.
      refreshToken: tokens.refreshToken,
      expiresInSeconds: tokens.expiresInSeconds,
    };
  }
}
