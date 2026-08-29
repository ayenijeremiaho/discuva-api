import { SocialAccount } from '../entity/social-account.entity';
import { SocialPostMedia } from '../entity/social-post-media.entity';
import { SocialPlacement } from '../enum/social-media.enum';

export interface PublishResult {
  success: boolean;
  error?: string;
  externalPostId?: string;
}

// The extension point for wiring in a real platform later: implement this
// per SocialPlatform (e.g. FacebookGraphPublisher, XApiPublisher) and
// register it in SocialPublisherRegistry — SocialPostService never needs to
// change beyond calling this same method, it just looks up whichever
// publisher is registered for the target account's platform.
//
// content/media arrive already resolved for this specific target —
// content is target.contentOverride ?? post.content, and media's urls are
// already cropped for this target's placement (SocialMediaCropService),
// not the raw uploaded originals. A publisher never touches
// SocialPostTarget/SocialPost itself, so it can't forget to resolve an
// override or a crop — that resolution happens exactly once, in
// SocialPostService, before any publisher is called.
//
// placement is the specific SocialPostTarget's placement (FEED/STORY/REEL)
// — a single account can have multiple targets across placements for the
// same post, so this is the only way a publisher knows which one a given
// call is for. A publisher that doesn't support a placement
// SocialMediaValidationService allows should fail that call explicitly
// (via PublishResult.error), not silently substitute FEED.
export interface SocialPlatformPublisher {
  publish(
    account: SocialAccount,
    content: string,
    media: SocialPostMedia[],
    placement: SocialPlacement,
  ): Promise<PublishResult>;
}
