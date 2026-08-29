import { SocialAccount } from '../entity/social-account.entity';

// Deliberately loose — every field optional, since not every platform
// exposes every metric (and some, like Facebook's public dislikeCount
// equivalent, simply don't exist). undefined means "this platform doesn't
// report this metric," not "zero."
export interface PostStats {
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
}

// The extension point for wiring in real per-platform stats later —
// implement this per SocialPlatform and register it in
// SocialStatsFetcherRegistry, same shape as SocialPlatformPublisher.
// SocialPostService never needs to change beyond calling this method.
export interface SocialStatsFetcher {
  getStats(account: SocialAccount, externalPostId: string): Promise<PostStats>;
}
