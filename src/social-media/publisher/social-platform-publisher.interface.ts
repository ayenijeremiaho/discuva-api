import { SocialAccount } from '../entity/social-account.entity';
import { SocialPost } from '../entity/social-post.entity';

export interface PublishResult {
  success: boolean;
  error?: string;
  externalPostId?: string;
}

// The extension point for wiring in a real platform later: implement this
// per SocialPlatform (e.g. FacebookGraphPublisher, XApiPublisher) and
// register it in SocialPublisherRegistry — SocialPostService never needs to
// change, it just looks up whichever publisher is registered for the
// target account's platform.
export interface SocialPlatformPublisher {
  publish(account: SocialAccount, post: SocialPost): Promise<PublishResult>;
}
