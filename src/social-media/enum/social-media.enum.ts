export enum SocialPlatform {
  FACEBOOK = 'FACEBOOK',
  INSTAGRAM = 'INSTAGRAM',
  X = 'X',
  YOUTUBE = 'YOUTUBE',
  TIKTOK = 'TIKTOK',
}

export enum SocialPostStatus {
  DRAFT = 'DRAFT',
  // Queued on the social-post-publish Bull queue via a delayed job — the
  // job fires at scheduledFor and calls the exact same publish() path
  // "Publish Now" does; this status only marks the waiting period.
  SCHEDULED = 'SCHEDULED',
  PUBLISHING = 'PUBLISHING',
  PUBLISHED = 'PUBLISHED',
  PARTIALLY_PUBLISHED = 'PARTIALLY_PUBLISHED',
  FAILED = 'FAILED',
}

export enum SocialPostTargetStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

// Instagram Stories/Reels and YouTube Shorts are genuinely different
// publish surfaces from a normal feed post (different endpoint, different
// aspect-ratio/duration constraints) even though they share the same
// underlying connected SocialAccount — one account can have multiple
// targets across placements for the same post. YouTube has no third
// placement of its own; REEL doubles as "Shorts" for it, since a Short is
// still just a video upload, only vertical + short — no separate API.
export enum SocialPlacement {
  FEED = 'FEED',
  STORY = 'STORY',
  REEL = 'REEL',
}
