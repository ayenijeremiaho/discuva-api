import { Injectable } from '@nestjs/common';
import { SocialPlatform } from '../enum/social-media.enum';
import { SocialStatsFetcher } from './social-stats-fetcher.interface';
import { NoStatsAvailable } from './no-stats-available';
import { YouTubeStatsFetcher } from './youtube-stats-fetcher';

@Injectable()
export class SocialStatsFetcherRegistry {
  private readonly fetchers: Record<SocialPlatform, SocialStatsFetcher>;

  constructor(
    noStatsAvailable: NoStatsAvailable,
    youtubeStatsFetcher: YouTubeStatsFetcher,
  ) {
    this.fetchers = {
      [SocialPlatform.FACEBOOK]: noStatsAvailable,
      [SocialPlatform.INSTAGRAM]: noStatsAvailable,
      [SocialPlatform.X]: noStatsAvailable,
      [SocialPlatform.YOUTUBE]: youtubeStatsFetcher,
      [SocialPlatform.TIKTOK]: noStatsAvailable,
    };
  }

  resolve(platform: SocialPlatform): SocialStatsFetcher {
    return this.fetchers[platform];
  }
}
