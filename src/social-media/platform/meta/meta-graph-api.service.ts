import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { SocialPlatformApp } from '../../../platform-admin/entity/social-platform-app.entity';
import { SocialPostMedia } from '../../entity/social-post-media.entity';
import { SocialPlacement } from '../../enum/social-media.enum';

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const AUTHORIZE_BASE = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;

// Video containers process asynchronously on Meta's side — publishing
// before status_code reaches FINISHED fails outright, so this bounds how
// long resolvePageAccessToken/publish wait before giving up rather than
// hanging a Bull job indefinitely.
const VIDEO_POLL_INTERVAL_MS = 3_000;
const VIDEO_POLL_MAX_ATTEMPTS = 20;

export interface ResolvedPage {
  pageId: string;
  pageName: string;
  pageAccessToken: string;
}

// Shared by FacebookOAuthExchanger/InstagramOAuthExchanger and
// FacebookGraphPublisher/InstagramGraphPublisher — Instagram business
// publishing is, underneath, the same Graph API, the same Page access
// token, and (for OAuth) the same Business Login dialog as Facebook; only
// which node you call (a Page vs. its linked IG Business Account) differs.
// Keeping that shared pipeline in one place means the two exchangers and
// two publishers are each a thin, honest adapter rather than four copies
// of the same multi-step token dance.
@Injectable()
export class MetaGraphApiService {
  private readonly logger = new Logger(MetaGraphApiService.name);

  // Facebook Login for Business (config_id) and classic Facebook Login
  // (scope) are mutually exclusive on this dialog — Meta's own docs
  // recommend not sending scope once a config_id is in play, and in
  // practice mixing them is what produces a partial "Invalid Scopes"
  // rejection rather than a clean success or failure. app.configId is only
  // set for a platform app actually configured for Business Login (see
  // SocialPlatformApp.configId's own comment); everything else still goes
  // through the classic scope param.
  buildAuthorizeUrl(app: SocialPlatformApp, state: string): string {
    const params = new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: app.redirectUri,
      state,
      response_type: 'code',
    });
    if (app.configId) {
      params.set('config_id', app.configId);
    } else {
      params.set('scope', app.scopes);
    }
    return `${AUTHORIZE_BASE}?${params.toString()}`;
  }

  // code -> short-lived user token -> long-lived user token -> the Page(s)
  // that user token can manage. Meta's OAuth dialog lets the person
  // connecting choose which Pages to grant, so exactly one is the expected
  // outcome for a church connecting a single Page — this throws a clear,
  // actionable error for zero or multiple instead of guessing.
  async resolvePageAccessToken(
    code: string,
    app: SocialPlatformApp,
    clientSecret: string,
  ): Promise<ResolvedPage> {
    const shortLived = await this.get<{ access_token: string }>(
      '/oauth/access_token',
      {
        client_id: app.clientId,
        client_secret: clientSecret,
        redirect_uri: app.redirectUri,
        code,
      },
    );

    const longLived = await this.get<{ access_token: string }>(
      '/oauth/access_token',
      {
        grant_type: 'fb_exchange_token',
        client_id: app.clientId,
        client_secret: clientSecret,
        fb_exchange_token: shortLived.access_token,
      },
    );

    const pages = await this.get<{
      data: { id: string; name: string; access_token: string }[];
    }>('/me/accounts', { access_token: longLived.access_token });

    if (pages.data.length === 0) {
      throw new InternalServerErrorException(
        'No Facebook Page was granted during authorization — reconnect and select at least one Page.',
      );
    }
    if (pages.data.length > 1) {
      throw new InternalServerErrorException(
        `${pages.data.length} Facebook Pages were granted during authorization — Discuva connects one Page per account. Reconnect and select only the Page for this church.`,
      );
    }

    const [page] = pages.data;
    return {
      pageId: page.id,
      pageName: page.name,
      pageAccessToken: page.access_token,
    };
  }

  async getInstagramBusinessAccountId(
    pageId: string,
    pageAccessToken: string,
  ): Promise<string> {
    const result = await this.get<{
      instagram_business_account?: { id: string };
    }>(`/${pageId}`, {
      fields: 'instagram_business_account',
      access_token: pageAccessToken,
    });
    if (!result.instagram_business_account) {
      throw new InternalServerErrorException(
        'This Facebook Page has no Instagram Business account linked — link one in Meta Business Suite, then reconnect.',
      );
    }
    return result.instagram_business_account.id;
  }

  // Only FEED is implemented — SocialMediaValidationService's constraints
  // table only defines FEED for Facebook today, so a non-FEED placement
  // reaching here would mean validation itself changed without a matching
  // publish path; failing loudly is correct, not a workaround. Single
  // attachment (the primary image or video), matching what validation
  // actually checks today (primaryVideo, not a gallery). Text-only when
  // there's no media at all.
  async publishToFacebookPage(
    pageId: string,
    pageAccessToken: string,
    content: string,
    media: SocialPostMedia[],
    placement: SocialPlacement,
  ): Promise<string> {
    if (placement !== SocialPlacement.FEED) {
      throw new InternalServerErrorException(
        `Facebook ${placement} publishing isn't implemented yet — only FEED is supported.`,
      );
    }

    const video = media.find((m) => m.mimeType.startsWith('video/'));
    const image = media.find((m) => m.mimeType.startsWith('image/'));

    if (video) {
      const result = await this.post<{ id: string }>(`/${pageId}/videos`, {
        file_url: video.url,
        description: content,
        access_token: pageAccessToken,
      });
      return result.id;
    }
    if (image) {
      const result = await this.post<{ id: string; post_id?: string }>(
        `/${pageId}/photos`,
        { url: image.url, caption: content, access_token: pageAccessToken },
      );
      return result.post_id ?? result.id;
    }
    const result = await this.post<{ id: string }>(`/${pageId}/feed`, {
      message: content,
      access_token: pageAccessToken,
    });
    return result.id;
  }

  // Instagram's publish flow is always two calls regardless of media type:
  // create a container, then publish it. What differs by placement is the
  // container's media_type: STORY uses 'STORIES' (image or video); FEED
  // and REEL are, as far as this API is concerned, the same call — a
  // video posted via the Content Publishing API always processes as a
  // Reel (media_type: 'REELS') even when it also appears in the normal
  // feed, and an image needs no media_type at all (defaults to IMAGE) in
  // either placement. Video containers process asynchronously on Meta's
  // side, so this polls status_code before publishing rather than racing
  // Meta's own processing.
  async publishToInstagram(
    igUserId: string,
    pageAccessToken: string,
    content: string,
    media: SocialPostMedia[],
    placement: SocialPlacement,
  ): Promise<string> {
    const video = media.find((m) => m.mimeType.startsWith('video/'));
    const image = media.find((m) => m.mimeType.startsWith('image/'));
    if (!video && !image) {
      throw new InternalServerErrorException(
        'Instagram requires an image or video attachment — a text-only post cannot be published.',
      );
    }

    // Stories don't render caption text visibly, but Meta's API still
    // accepts the field — passed through for consistency rather than
    // silently dropping content the admin typed.
    const containerParams: Record<string, string> = {
      caption: content,
      access_token: pageAccessToken,
    };
    const mediaUrlField = video ? 'video_url' : 'image_url';
    containerParams[mediaUrlField] = (video ?? image)!.url;

    if (placement === SocialPlacement.STORY) {
      containerParams.media_type = 'STORIES';
    } else if (video) {
      containerParams.media_type = 'REELS';
    }

    const container = await this.post<{ id: string }>(
      `/${igUserId}/media`,
      containerParams,
    );

    if (video) {
      await this.waitUntilVideoContainerReady(container.id, pageAccessToken);
    }

    const published = await this.post<{ id: string }>(
      `/${igUserId}/media_publish`,
      { creation_id: container.id, access_token: pageAccessToken },
    );
    return published.id;
  }

  private async waitUntilVideoContainerReady(
    containerId: string,
    pageAccessToken: string,
  ): Promise<void> {
    for (let attempt = 0; attempt < VIDEO_POLL_MAX_ATTEMPTS; attempt++) {
      const status = await this.get<{ status_code: string }>(
        `/${containerId}`,
        { fields: 'status_code', access_token: pageAccessToken },
      );
      if (status.status_code === 'FINISHED') return;
      if (status.status_code === 'ERROR') {
        throw new InternalServerErrorException(
          'Instagram failed to process the video attachment.',
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, VIDEO_POLL_INTERVAL_MS),
      );
    }
    throw new InternalServerErrorException(
      'Instagram video processing timed out before it could be published.',
    );
  }

  private async get<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<T> {
    const query = new URLSearchParams(params).toString();
    return this.request<T>('GET', `${path}?${query}`);
  }

  private async post<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<T> {
    const query = new URLSearchParams(params).toString();
    return this.request<T>('POST', `${path}?${query}`);
  }

  private async request<T>(method: 'GET' | 'POST', path: string): Promise<T> {
    const response = await fetch(`${GRAPH_BASE}${path}`, { method });
    const json: any = await response.json().catch(() => ({}));

    if (!response.ok || json.error) {
      const message = json.error?.message ?? 'Meta Graph API request failed.';
      this.logger.error(
        `Meta Graph API ${path.split('?')[0]} failed: ${message}`,
      );
      throw new InternalServerErrorException(message);
    }
    return json as T;
  }
}
