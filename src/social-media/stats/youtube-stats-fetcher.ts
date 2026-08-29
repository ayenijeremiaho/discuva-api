import { Injectable } from '@nestjs/common';
import { SocialAccount } from '../entity/social-account.entity';
import { SocialTokenResolverService } from '../service/social-token-resolver.service';
import { YouTubeApiService } from '../platform/youtube/youtube-api.service';
import {
  PostStats,
  SocialStatsFetcher,
} from './social-stats-fetcher.interface';

@Injectable()
export class YouTubeStatsFetcher implements SocialStatsFetcher {
  constructor(
    private readonly tokenResolver: SocialTokenResolverService,
    private readonly youtubeApi: YouTubeApiService,
  ) {}

  async getStats(
    account: SocialAccount,
    externalPostId: string,
  ): Promise<PostStats> {
    const accessToken = await this.tokenResolver.getValidAccessToken(
      account.id,
    );
    return this.youtubeApi.getVideoStats(externalPostId, accessToken);
  }
}
