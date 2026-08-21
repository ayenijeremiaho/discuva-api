export interface RefreshResult {
  accessToken: string;
  // Some platforms rotate the refresh token itself on every use (e.g. X's
  // OAuth 2.0 PKCE); others keep issuing against the same one. Omitted
  // means "unchanged, keep using the existing refresh token."
  refreshToken?: string;
  expiresInSeconds: number;
}

// The extension point for wiring in a real per-platform token refresh
// later — implement this per SocialPlatform (e.g. FacebookTokenRefresher)
// and register it in SocialTokenRefresherRegistry, alongside registering
// that platform's real SocialPlatformPublisher. SocialTokenResolverService
// never needs to change.
export interface SocialTokenRefresher {
  refresh(refreshToken: string): Promise<RefreshResult>;
}
