import { SocialPlatformApp } from '../../platform-admin/entity/social-platform-app.entity';

export interface OAuthExchangeResult {
  accessToken: string;
  refreshToken?: string;
  // Omitted for platforms whose token has no natural expiry (e.g. a
  // long-lived Facebook Page token) — SocialTokenResolverService treats a
  // null tokenExpiresAt as "never needs refreshing."
  expiresInSeconds?: number;
  scope?: string;
  // Platform-specific meaning (Page ID, Channel ID, ...) — resolved during
  // the exchange itself since some platforms (Facebook/Instagram) only
  // yield a user token first and need a follow-up call to find the actual
  // Page/IG Business Account being connected.
  externalAccountId?: string;
}

// The extension point for wiring in a real per-platform OAuth flow —
// implement this per SocialPlatform alongside that platform's
// SocialPlatformPublisher and SocialTokenRefresher, and register it in
// SocialOAuthExchangerRegistry. SocialOAuthConnectService never needs to
// change.
export interface SocialOAuthExchanger {
  buildAuthorizeUrl(app: SocialPlatformApp, state: string): string;
  exchangeCode(
    code: string,
    app: SocialPlatformApp,
    clientSecret: string,
  ): Promise<OAuthExchangeResult>;
}
