import { Injectable } from '@nestjs/common';
import {
  PostStats,
  SocialStatsFetcher,
} from './social-stats-fetcher.interface';

// The default for every platform until a real fetcher is registered.
@Injectable()
export class NoStatsAvailable implements SocialStatsFetcher {
  async getStats(): Promise<PostStats> {
    throw new Error("Stats aren't available for this platform yet.");
  }
}
