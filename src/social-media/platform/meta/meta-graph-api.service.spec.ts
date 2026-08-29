import { InternalServerErrorException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MetaGraphApiService } from './meta-graph-api.service';
import { SocialPlatformApp } from '../../../platform-admin/entity/social-platform-app.entity';
import { SocialPostMedia } from '../../entity/social-post-media.entity';
import { SocialPlacement, SocialPlatform } from '../../enum/social-media.enum';

const app: SocialPlatformApp = {
  platform: SocialPlatform.FACEBOOK,
  clientId: 'client-1',
  clientSecretEncrypted: 'irrelevant',
  redirectUri:
    'https://api.discuva.org/v1/integrations/social/FACEBOOK/oauth/callback',
  scopes: 'pages_show_list,pages_manage_posts',
  isActive: true,
};

function mockFetchOnce(status: number, body: any) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    json: async () => body,
  });
}

function media(overrides: Partial<SocialPostMedia>): SocialPostMedia {
  return {
    id: 'm-1',
    url: 'https://cdn.example.com/file',
    publicId: 'p-1',
    mimeType: 'image/jpeg',
    sizeBytes: 1000,
    width: null,
    height: null,
    durationSeconds: null,
    order: 0,
    ...overrides,
  } as SocialPostMedia;
}

describe('MetaGraphApiService', () => {
  let service: MetaGraphApiService;

  beforeEach(async () => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [MetaGraphApiService],
    }).compile();
    service = module.get(MetaGraphApiService);
  });

  describe('buildAuthorizeUrl', () => {
    it('builds a Meta OAuth dialog URL with the app credentials and state', () => {
      const url = service.buildAuthorizeUrl(app, 'encoded-state');
      expect(url).toContain('https://www.facebook.com/');
      expect(url).toContain('/dialog/oauth?');
      expect(url).toContain('client_id=client-1');
      expect(url).toContain('state=encoded-state');
      expect(url).toContain(
        'redirect_uri=' + encodeURIComponent(app.redirectUri),
      );
    });
  });

  describe('resolvePageAccessToken', () => {
    it('exchanges code for a long-lived token then returns the single granted Page', async () => {
      mockFetchOnce(200, { access_token: 'short-lived' });
      mockFetchOnce(200, { access_token: 'long-lived' });
      mockFetchOnce(200, {
        data: [
          { id: 'page-1', name: 'Grace Chapel', access_token: 'page-token' },
        ],
      });

      const result = await service.resolvePageAccessToken(
        'auth-code',
        app,
        'secret',
      );

      expect(result).toEqual({
        pageId: 'page-1',
        pageName: 'Grace Chapel',
        pageAccessToken: 'page-token',
      });
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('throws when no Page was granted during authorization', async () => {
      mockFetchOnce(200, { access_token: 'short-lived' });
      mockFetchOnce(200, { access_token: 'long-lived' });
      mockFetchOnce(200, { data: [] });

      await expect(
        service.resolvePageAccessToken('auth-code', app, 'secret'),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('throws when more than one Page was granted during authorization', async () => {
      mockFetchOnce(200, { access_token: 'short-lived' });
      mockFetchOnce(200, { access_token: 'long-lived' });
      mockFetchOnce(200, {
        data: [
          { id: 'page-1', name: 'A', access_token: 't1' },
          { id: 'page-2', name: 'B', access_token: 't2' },
        ],
      });

      await expect(
        service.resolvePageAccessToken('auth-code', app, 'secret'),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('surfaces a Meta API error response as InternalServerErrorException', async () => {
      mockFetchOnce(400, { error: { message: 'Invalid authorization code' } });

      await expect(
        service.resolvePageAccessToken('bad-code', app, 'secret'),
      ).rejects.toThrow('Invalid authorization code');
    });
  });

  describe('getInstagramBusinessAccountId', () => {
    it('returns the linked IG Business Account id', async () => {
      mockFetchOnce(200, { instagram_business_account: { id: 'ig-1' } });
      const id = await service.getInstagramBusinessAccountId(
        'page-1',
        'page-token',
      );
      expect(id).toBe('ig-1');
    });

    it('throws when the Page has no linked Instagram Business account', async () => {
      mockFetchOnce(200, {});
      await expect(
        service.getInstagramBusinessAccountId('page-1', 'page-token'),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('publishToFacebookPage', () => {
    it('posts text-only content to /feed when there is no media', async () => {
      mockFetchOnce(200, { id: 'post-1' });
      const id = await service.publishToFacebookPage(
        'page-1',
        'page-token',
        'Hello church',
        [],
        SocialPlacement.FEED,
      );
      expect(id).toBe('post-1');
      const [url] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain('/page-1/feed');
    });

    it('posts a single image via /photos', async () => {
      mockFetchOnce(200, { id: 'photo-1', post_id: 'post-1' });
      const id = await service.publishToFacebookPage(
        'page-1',
        'page-token',
        'Caption',
        [media({ mimeType: 'image/jpeg' })],
        SocialPlacement.FEED,
      );
      expect(id).toBe('post-1');
      const [url] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain('/page-1/photos');
    });

    it('posts a single video via /videos, preferring it over an image if both are attached', async () => {
      mockFetchOnce(200, { id: 'video-1' });
      const id = await service.publishToFacebookPage(
        'page-1',
        'page-token',
        'Caption',
        [
          media({ id: 'img', mimeType: 'image/jpeg' }),
          media({ id: 'vid', mimeType: 'video/mp4' }),
        ],
        SocialPlacement.FEED,
      );
      expect(id).toBe('video-1');
      const [url] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain('/page-1/videos');
    });

    it('rejects any placement other than FEED, without making a request', async () => {
      await expect(
        service.publishToFacebookPage(
          'page-1',
          'page-token',
          'Caption',
          [media({ mimeType: 'image/jpeg' })],
          SocialPlacement.STORY,
        ),
      ).rejects.toThrow('only FEED is supported');
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('publishToInstagram', () => {
    it('creates an image container with no media_type for FEED, then publishes it', async () => {
      mockFetchOnce(200, { id: 'container-1' });
      mockFetchOnce(200, { id: 'media-1' });

      const id = await service.publishToInstagram(
        'ig-1',
        'page-token',
        'Caption',
        [media({ mimeType: 'image/jpeg' })],
        SocialPlacement.FEED,
      );

      expect(id).toBe('media-1');
      expect(global.fetch).toHaveBeenCalledTimes(2);
      const [containerUrl] = (global.fetch as jest.Mock).mock.calls[0];
      expect(containerUrl).not.toContain('media_type');
    });

    it('polls the video container until FINISHED before publishing, using media_type=REELS for a FEED video', async () => {
      mockFetchOnce(200, { id: 'container-1' }); // create container
      mockFetchOnce(200, { status_code: 'IN_PROGRESS' }); // poll 1
      mockFetchOnce(200, { status_code: 'FINISHED' }); // poll 2
      mockFetchOnce(200, { id: 'media-1' }); // publish

      const id = await service.publishToInstagram(
        'ig-1',
        'page-token',
        'Caption',
        [media({ mimeType: 'video/mp4' })],
        SocialPlacement.FEED,
      );

      expect(id).toBe('media-1');
      expect(global.fetch).toHaveBeenCalledTimes(4);
      const [containerUrl] = (global.fetch as jest.Mock).mock.calls[0];
      expect(containerUrl).toContain('media_type=REELS');
    }, 10_000);

    it('uses media_type=STORIES for a STORY placement, image or video', async () => {
      mockFetchOnce(200, { id: 'container-1' });
      mockFetchOnce(200, { id: 'media-1' });

      await service.publishToInstagram(
        'ig-1',
        'page-token',
        'Caption',
        [media({ mimeType: 'image/jpeg' })],
        SocialPlacement.STORY,
      );

      const [containerUrl] = (global.fetch as jest.Mock).mock.calls[0];
      expect(containerUrl).toContain('media_type=STORIES');
    });

    it('uses media_type=REELS for an explicit REEL placement', async () => {
      mockFetchOnce(200, { id: 'container-1' });
      mockFetchOnce(200, { status_code: 'FINISHED' });
      mockFetchOnce(200, { id: 'media-1' });

      await service.publishToInstagram(
        'ig-1',
        'page-token',
        'Caption',
        [media({ mimeType: 'video/mp4' })],
        SocialPlacement.REEL,
      );

      const [containerUrl] = (global.fetch as jest.Mock).mock.calls[0];
      expect(containerUrl).toContain('media_type=REELS');
    });

    it('throws if the video container errors out during processing', async () => {
      mockFetchOnce(200, { id: 'container-1' });
      mockFetchOnce(200, { status_code: 'ERROR' });

      await expect(
        service.publishToInstagram(
          'ig-1',
          'page-token',
          'Caption',
          [media({ mimeType: 'video/mp4' })],
          SocialPlacement.FEED,
        ),
      ).rejects.toThrow('failed to process');
    });

    it('throws when there is no image or video attachment, without making a request', async () => {
      await expect(
        service.publishToInstagram(
          'ig-1',
          'page-token',
          'Text only',
          [],
          SocialPlacement.FEED,
        ),
      ).rejects.toThrow('requires an image or video');
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
