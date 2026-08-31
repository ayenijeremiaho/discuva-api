import { SocialPlatform } from '../../social-media/enum/social-media.enum';

export interface KnownSocialScope {
  value: string;
  label: string;
  // Without this scope, the platform's publisher/exchanger genuinely can't
  // function (e.g. pages_manage_posts can't publish without pages_show_list
  // resolving a Page id first) — PlatformSocialAppService.upsertApp() blocks
  // registering a platform missing one of these, rather than accepting an
  // app that would only fail later at publish time.
  required: boolean;
}

// Meta accepts either separator in the OAuth dialog's `scope` param (their
// own docs: "A comma or space separated list") — comma kept for parity with
// the convention shown across Meta's own examples. Google/YouTube's OAuth2
// implementation is space-only.
export const SCOPE_SEPARATOR: Partial<Record<SocialPlatform, string>> = {
  [SocialPlatform.FACEBOOK]: ',',
  [SocialPlatform.INSTAGRAM]: ',',
  [SocialPlatform.YOUTUBE]: ' ',
};

// Platforms with no entry here (X, TikTok) have no real exchanger yet
// (NoExchangerAvailable) — nothing to validate against, so upsertApp()
// accepts any non-empty scope list for them rather than guessing.
//
// Facebook and Instagram permission names, dependency chains, and Standard
// Access status verified against developers.facebook.com/docs/permissions/
// reference; YouTube scope URLs verified against
// developers.google.com/youtube/v3/guides/auth.
export const KNOWN_SOCIAL_SCOPES: Partial<
  Record<SocialPlatform, KnownSocialScope[]>
> = {
  [SocialPlatform.FACEBOOK]: [
    {
      value: 'pages_show_list',
      label: 'List the Pages you manage',
      required: true,
    },
    {
      value: 'pages_read_engagement',
      label: 'Read Page engagement (required by pages_manage_posts)',
      required: true,
    },
    {
      value: 'pages_manage_posts',
      label: 'Publish posts, photos, and videos to a Page',
      required: true,
    },
  ],
  [SocialPlatform.INSTAGRAM]: [
    {
      value: 'pages_show_list',
      label: 'List the Pages you manage',
      required: true,
    },
    {
      value: 'pages_read_engagement',
      label: 'Read Page engagement (required by instagram_content_publish)',
      required: true,
    },
    {
      value: 'pages_read_user_content',
      label: "Read a Page's content (required by instagram_basic)",
      required: true,
    },
    {
      value: 'instagram_basic',
      label: 'Read the linked Instagram Business account',
      required: true,
    },
    {
      value: 'instagram_content_publish',
      label: 'Publish content to Instagram',
      required: true,
    },
  ],
  [SocialPlatform.YOUTUBE]: [
    {
      value: 'https://www.googleapis.com/auth/youtube.upload',
      label: 'Upload videos',
      required: true,
    },
    {
      value: 'https://www.googleapis.com/auth/youtube.readonly',
      label: 'Read channel videos & stats',
      required: false,
    },
  ],
};
