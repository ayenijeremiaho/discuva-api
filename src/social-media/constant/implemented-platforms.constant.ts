import { SocialPlatform } from '../enum/social-media.enum';

// Platforms with a real SocialOAuthExchanger + SocialPlatformPublisher
// registered (see SocialOAuthExchangerRegistry / SocialPublisherRegistry) —
// every other platform resolves to NoExchangerAvailable/NotConnectedPublisher
// and can't actually connect or publish no matter what's registered for it
// in social_platform_apps. Intersected with PlatformSocialAppService's
// active-app list in SocialMediaController's GET available-platforms, so a
// platform stays hidden from the tenant "Add Account" picker until it's
// both built AND deliberately switched on — e.g. going live with Facebook,
// Instagram, and YouTube without exposing X/TikTok as connectable options,
// even though registering an app row for them wouldn't error.
export const IMPLEMENTED_PLATFORMS: SocialPlatform[] = [
  SocialPlatform.FACEBOOK,
  SocialPlatform.INSTAGRAM,
  SocialPlatform.YOUTUBE,
];
