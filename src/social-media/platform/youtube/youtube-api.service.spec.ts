import { InternalServerErrorException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { YouTubeApiService } from './youtube-api.service';
import { SocialPlatformApp } from '../../../platform-admin/entity/social-platform-app.entity';
import { SocialPostMedia } from '../../entity/social-post-media.entity';
import { SocialPlacement, SocialPlatform } from '../../enum/social-media.enum';

const app: SocialPlatformApp = {
  platform: SocialPlatform.YOUTUBE,
  clientId: 'client-1',
  clientSecretEncrypted: 'irrelevant',
  redirectUri:
    'https://api.discuva.org/v1/integrations/social/YOUTUBE/oauth/callback',
  scopes:
    'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
  configId: null,
  isActive: true,
};

function media(overrides: Partial<SocialPostMedia> = {}): SocialPostMedia {
  return {
    id: 'm-1',
    url: 'https://res.cloudinary.com/demo/video/upload/v1/clip.mp4',
    publicId: 'p-1',
    mimeType: 'video/mp4',
    sizeBytes: 5000,
    width: null,
    height: null,
    durationSeconds: 30,
    order: 0,
    ...overrides,
  } as SocialPostMedia;
}

function mockFetchJson(
  status: number,
  body: any,
  headers: Record<string, string> = {},
) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    json: async () => body,
    headers: { get: (key: string) => headers[key.toLowerCase()] ?? null },
  });
}

function mockFetchBinary(status: number, buffer: ArrayBuffer) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    arrayBuffer: async () => buffer,
  });
}

describe('YouTubeApiService', () => {
  let service: YouTubeApiService;

  beforeEach(async () => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [YouTubeApiService],
    }).compile();
    service = module.get(YouTubeApiService);
  });

  describe('buildAuthorizeUrl', () => {
    it('includes access_type=offline and prompt=consent so a refresh token is always issued', () => {
      const url = service.buildAuthorizeUrl(app, 'state-1');
      expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth?');
      expect(url).toContain('access_type=offline');
      expect(url).toContain('prompt=consent');
      expect(url).toContain('client_id=client-1');
      expect(url).toContain('state=state-1');
    });
  });

  describe('exchangeCode / refreshAccessToken', () => {
    it('exchanges a code for tokens via the standard OAuth2 token endpoint', async () => {
      mockFetchJson(200, {
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: 3600,
      });

      const result = await service.exchangeCode('code-1', app, 'secret');

      expect(result).toEqual({
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresInSeconds: 3600,
      });
      const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://oauth2.googleapis.com/token');
      expect(options.body).toContain('grant_type=authorization_code');
    });

    it('refreshes an access token, typically without a rotated refresh token', async () => {
      mockFetchJson(200, { access_token: 'access-2', expires_in: 3600 });

      const result = await service.refreshAccessToken(
        'refresh-1',
        app,
        'secret',
      );

      expect(result.accessToken).toBe('access-2');
      expect(result.refreshToken).toBeUndefined();
      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(options.body).toContain('grant_type=refresh_token');
    });

    it('throws when Google returns an OAuth error', async () => {
      mockFetchJson(400, {
        error: 'invalid_grant',
        error_description: 'Bad refresh token',
      });

      await expect(
        service.refreshAccessToken('bad', app, 'secret'),
      ).rejects.toThrow('Bad refresh token');
    });
  });

  describe('resolveChannel', () => {
    it('returns the single channel found', async () => {
      mockFetchJson(200, {
        items: [{ id: 'chan-1', snippet: { title: 'Grace Chapel' } }],
      });

      const channel = await service.resolveChannel('access-1');

      expect(channel).toEqual({
        channelId: 'chan-1',
        channelTitle: 'Grace Chapel',
      });
    });

    it('throws when the account has no channel', async () => {
      mockFetchJson(200, { items: [] });
      await expect(service.resolveChannel('access-1')).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('throws when the account has multiple channels', async () => {
      mockFetchJson(200, {
        items: [
          { id: 'chan-1', snippet: { title: 'A' } },
          { id: 'chan-2', snippet: { title: 'B' } },
        ],
      });
      await expect(service.resolveChannel('access-1')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('publishVideo', () => {
    it('throws when there is no video attachment', async () => {
      await expect(
        service.publishVideo('access-1', 'Caption', [], SocialPlacement.FEED),
      ).rejects.toThrow('requires a video attachment');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('downloads the video, starts a resumable session, and uploads the bytes', async () => {
      const bytes = new ArrayBuffer(8);
      mockFetchBinary(200, bytes); // download from Cloudinary
      mockFetchJson(
        200,
        {},
        { location: 'https://upload.example.com/session-1' },
      ); // start session
      mockFetchJson(201, { id: 'yt-video-1' }); // upload bytes

      const id = await service.publishVideo(
        'access-1',
        'Sunday service highlights',
        [media()],
        SocialPlacement.FEED,
      );

      expect(id).toBe('yt-video-1');
      expect(global.fetch).toHaveBeenCalledTimes(3);
      const [uploadUrl, uploadOptions] = (global.fetch as jest.Mock).mock
        .calls[2];
      expect(uploadUrl).toBe('https://upload.example.com/session-1');
      expect(uploadOptions.method).toBe('PUT');
    });

    it('appends #Shorts to the description for a REEL placement, not FEED', async () => {
      const bytes = new ArrayBuffer(8);
      mockFetchBinary(200, bytes);
      mockFetchJson(
        200,
        {},
        { location: 'https://upload.example.com/session-1' },
      );
      mockFetchJson(201, { id: 'yt-video-1' });

      await service.publishVideo(
        'access-1',
        'Quick word',
        [media()],
        SocialPlacement.REEL,
      );

      const [, sessionOptions] = (global.fetch as jest.Mock).mock.calls[1];
      const metadata = JSON.parse(sessionOptions.body);
      expect(metadata.snippet.description).toContain('#Shorts');
    });

    it('throws if downloading the source video fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        arrayBuffer: async () => new ArrayBuffer(0),
      });

      await expect(
        service.publishVideo(
          'access-1',
          'Caption',
          [media()],
          SocialPlacement.FEED,
        ),
      ).rejects.toThrow('Could not download');
    });

    it('throws if YouTube does not return a session Location header', async () => {
      mockFetchBinary(200, new ArrayBuffer(8));
      mockFetchJson(200, {}, {}); // no location header

      await expect(
        service.publishVideo(
          'access-1',
          'Caption',
          [media()],
          SocialPlacement.FEED,
        ),
      ).rejects.toThrow('did not return an upload session URL');
    });

    it('throws if the final upload step fails', async () => {
      mockFetchBinary(200, new ArrayBuffer(8));
      mockFetchJson(
        200,
        {},
        { location: 'https://upload.example.com/session-1' },
      );
      mockFetchJson(500, { error: { message: 'Upload broke' } });

      await expect(
        service.publishVideo(
          'access-1',
          'Caption',
          [media()],
          SocialPlacement.FEED,
        ),
      ).rejects.toThrow('Upload broke');
    });
  });

  describe('getVideoStats', () => {
    it('converts the stringified counts YouTube returns into numbers', async () => {
      mockFetchJson(200, {
        items: [
          {
            statistics: {
              viewCount: '1200',
              likeCount: '85',
              commentCount: '9',
            },
          },
        ],
      });

      const stats = await service.getVideoStats('yt-video-1', 'access-1');

      expect(stats).toEqual({
        viewCount: 1200,
        likeCount: 85,
        commentCount: 9,
      });
    });

    it('omits a metric YouTube did not report, rather than defaulting it to 0', async () => {
      mockFetchJson(200, { items: [{ statistics: { viewCount: '10' } }] });

      const stats = await service.getVideoStats('yt-video-1', 'access-1');

      expect(stats).toEqual({ viewCount: 10 });
      expect(stats.likeCount).toBeUndefined();
    });

    it('throws when the video no longer exists', async () => {
      mockFetchJson(200, { items: [] });

      await expect(
        service.getVideoStats('deleted-video', 'access-1'),
      ).rejects.toThrow('may have been deleted');
    });
  });
});
