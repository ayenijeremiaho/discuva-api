import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { SocialPlatformApp } from '../../../platform-admin/entity/social-platform-app.entity';
import { SocialPostMedia } from '../../entity/social-post-media.entity';
import { SocialPlacement } from '../../enum/social-media.enum';

const AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://www.googleapis.com/youtube/v3';
const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';
const TITLE_MAX_LENGTH = 100;

export interface GoogleTokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds: number;
}

export interface ResolvedChannel {
  channelId: string;
  channelTitle: string;
}

// Google's OAuth2 + YouTube Data API v3 mechanics, shared by
// YouTubeOAuthExchanger, YouTubePublisher, and YouTubeTokenRefresher — the
// same three-way split FacebookOAuthExchanger/FacebookGraphPublisher use
// for Meta, plus a refresher: unlike a Meta Page token (effectively
// non-expiring once issued via a long-lived user token), Google access
// tokens genuinely expire (~1 hour) and need the stored refresh_token to
// renew.
@Injectable()
export class YouTubeApiService {
  private readonly logger = new Logger(YouTubeApiService.name);

  buildAuthorizeUrl(app: SocialPlatformApp, state: string): string {
    const params = new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: app.redirectUri,
      response_type: 'code',
      scope: app.scopes,
      state,
      // Without both of these, Google only issues a refresh_token on a
      // user's very first-ever consent for this app — a reconnect after
      // revoking access would silently come back with no refresh_token at
      // all otherwise, and SocialTokenResolverService has nothing to renew
      // against once the short-lived access_token expires.
      access_type: 'offline',
      prompt: 'consent',
    });
    return `${AUTH_BASE}?${params.toString()}`;
  }

  async exchangeCode(
    code: string,
    app: SocialPlatformApp,
    clientSecret: string,
  ): Promise<GoogleTokenResult> {
    return this.requestToken({
      code,
      client_id: app.clientId,
      client_secret: clientSecret,
      redirect_uri: app.redirectUri,
      grant_type: 'authorization_code',
    });
  }

  async refreshAccessToken(
    refreshToken: string,
    app: SocialPlatformApp,
    clientSecret: string,
  ): Promise<GoogleTokenResult> {
    return this.requestToken({
      refresh_token: refreshToken,
      client_id: app.clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    });
  }

  // A Google account can have multiple channels/brand accounts — same
  // "exactly one expected" resolution FacebookOAuthExchanger uses for
  // Pages, since neither this exchanger nor Google's consent dialog lets
  // the connecting admin pick a specific one mid-flow.
  async resolveChannel(accessToken: string): Promise<ResolvedChannel> {
    const result = await this.get<{
      items: { id: string; snippet: { title: string } }[];
    }>('/channels', { part: 'id,snippet', mine: 'true' }, accessToken);

    if (result.items.length === 0) {
      throw new InternalServerErrorException(
        'No YouTube channel was found on this Google account — reconnect using an account that owns a channel.',
      );
    }
    if (result.items.length > 1) {
      throw new InternalServerErrorException(
        `${result.items.length} YouTube channels were found on this Google account — Discuva connects one channel per account. Reconnect using an account with only the intended channel.`,
      );
    }
    const [channel] = result.items;
    return { channelId: channel.id, channelTitle: channel.snippet.title };
  }

  // The Data API v3's own statistics — raw view/like/comment counts only.
  // Watch time, retention, and traffic sources live in the separate
  // YouTube Analytics API (its own scope, its own base URL), not
  // implemented here. dislikeCount has been private since December 2021;
  // favoriteCount is permanently 0 (deprecated) — neither is worth
  // surfacing. Counts come back as strings in the JSON response (Google's
  // usual convention for values that can exceed safe-integer range), so
  // this converts them to numbers for the caller.
  async getVideoStats(
    videoId: string,
    accessToken: string,
  ): Promise<{
    viewCount?: number;
    likeCount?: number;
    commentCount?: number;
  }> {
    const result = await this.get<{
      items: {
        statistics?: {
          viewCount?: string;
          likeCount?: string;
          commentCount?: string;
        };
      }[];
    }>('/videos', { part: 'statistics', id: videoId }, accessToken);

    const stats = result.items[0]?.statistics;
    if (!stats) {
      throw new InternalServerErrorException(
        'YouTube video not found — it may have been deleted.',
      );
    }
    return {
      viewCount:
        stats.viewCount !== undefined ? Number(stats.viewCount) : undefined,
      likeCount:
        stats.likeCount !== undefined ? Number(stats.likeCount) : undefined,
      commentCount:
        stats.commentCount !== undefined
          ? Number(stats.commentCount)
          : undefined,
    };
  }

  // YouTube has no URL-passthrough upload the way Meta's Graph API does —
  // the actual video bytes must be streamed to Google via the resumable
  // upload protocol (initiate a session, then PUT the bytes to the
  // returned session URL). This downloads the full file into memory
  // before re-uploading it rather than piping the download response
  // straight into the upload request — simpler and correct at the scale a
  // church's social posts run at (the existing 200MB attachment cap), but
  // a real memory cost worth knowing about if that cap ever grows; a
  // genuinely streamed pipe would avoid it at the cost of real complexity
  // this doesn't need yet.
  // No channelId parameter — videos.insert has no "upload to channel X"
  // field, the video always goes to whichever channel the access token
  // itself was issued for (resolved once, during OAuth, by
  // resolveChannel() above).
  async publishVideo(
    accessToken: string,
    content: string,
    media: SocialPostMedia[],
    placement: SocialPlacement,
  ): Promise<string> {
    const video = media.find((m) => m.mimeType.startsWith('video/'));
    if (!video) {
      throw new InternalServerErrorException(
        'YouTube requires a video attachment.',
      );
    }

    const title = content.trim().slice(0, TITLE_MAX_LENGTH) || 'Untitled';
    // "#Shorts" in the description is the documented, best-effort signal
    // for YouTube's Shorts shelf — not a guaranteed API flag. YouTube's
    // own aspect-ratio/duration heuristics still decide the actual
    // classification; this can't force it.
    const description =
      placement === SocialPlacement.REEL ? `${content}\n\n#Shorts` : content;

    const videoResponse = await fetch(video.url);
    if (!videoResponse.ok) {
      throw new InternalServerErrorException(
        'Could not download the video attachment to publish it to YouTube.',
      );
    }
    const videoBytes = await videoResponse.arrayBuffer();

    const sessionUrl = await this.startResumableSession(
      accessToken,
      video.mimeType,
      videoBytes.byteLength,
      { snippet: { title, description }, status: { privacyStatus: 'public' } },
    );

    const uploadResponse = await fetch(sessionUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': video.mimeType,
        'Content-Length': String(videoBytes.byteLength),
      },
      body: videoBytes,
    });
    const uploaded: any = await uploadResponse.json().catch(() => ({}));
    if (!uploadResponse.ok) {
      const message = uploaded.error?.message ?? 'YouTube upload failed.';
      this.logger.error(`YouTube upload failed: ${message}`);
      throw new InternalServerErrorException(message);
    }
    return uploaded.id;
  }

  private async startResumableSession(
    accessToken: string,
    mimeType: string,
    byteLength: number,
    metadata: Record<string, unknown>,
  ): Promise<string> {
    const response = await fetch(
      `${UPLOAD_URL}?uploadType=resumable&part=snippet,status`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': String(byteLength),
        },
        body: JSON.stringify(metadata),
      },
    );
    if (!response.ok) {
      const json: any = await response.json().catch(() => ({}));
      const message =
        json.error?.message ?? 'Could not start the YouTube upload session.';
      this.logger.error(`YouTube resumable session failed: ${message}`);
      throw new InternalServerErrorException(message);
    }
    const location = response.headers.get('location');
    if (!location) {
      throw new InternalServerErrorException(
        'YouTube did not return an upload session URL.',
      );
    }
    return location;
  }

  private async requestToken(
    params: Record<string, string>,
  ): Promise<GoogleTokenResult> {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    const json: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        json.error_description ?? json.error ?? 'Google token request failed.';
      this.logger.error(`Google OAuth token request failed: ${message}`);
      throw new InternalServerErrorException(message);
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresInSeconds: json.expires_in,
    };
  }

  private async get<T>(
    path: string,
    params: Record<string, string>,
    accessToken: string,
  ): Promise<T> {
    const query = new URLSearchParams(params).toString();
    const response = await fetch(`${API_BASE}${path}?${query}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = json.error?.message ?? 'YouTube Data API request failed.';
      this.logger.error(`YouTube Data API ${path} failed: ${message}`);
      throw new InternalServerErrorException(message);
    }
    return json as T;
  }
}
