import { Test, TestingModule } from '@nestjs/testing';
import { YouTubeTokenRefresher } from './youtube-token-refresher';
import { PlatformSocialAppService } from '../../platform-admin/service/platform-social-app.service';
import { YouTubeApiService } from '../platform/youtube/youtube-api.service';
import { SocialPlatform } from '../enum/social-media.enum';
import { SocialPlatformApp } from '../../platform-admin/entity/social-platform-app.entity';

const mockPlatformSocialAppService = { getDecryptedApp: jest.fn() };
const mockYoutubeApi = { refreshAccessToken: jest.fn() };

const app: SocialPlatformApp = {
  platform: SocialPlatform.YOUTUBE,
  clientId: 'client-1',
  clientSecretEncrypted: 'irrelevant',
  redirectUri:
    'https://api.discuva.org/v1/integrations/social/YOUTUBE/oauth/callback',
  scopes: 'https://www.googleapis.com/auth/youtube.upload',
  configId: null,
  isActive: true,
};

describe('YouTubeTokenRefresher', () => {
  let refresher: YouTubeTokenRefresher;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        YouTubeTokenRefresher,
        {
          provide: PlatformSocialAppService,
          useValue: mockPlatformSocialAppService,
        },
        { provide: YouTubeApiService, useValue: mockYoutubeApi },
      ],
    }).compile();
    refresher = module.get(YouTubeTokenRefresher);
  });

  it('looks up its own app credentials (YOUTUBE) and refreshes the access token', async () => {
    mockPlatformSocialAppService.getDecryptedApp.mockResolvedValue({
      app,
      clientSecret: 'secret',
    });
    mockYoutubeApi.refreshAccessToken.mockResolvedValue({
      accessToken: 'access-2',
      expiresInSeconds: 3600,
    });

    const result = await refresher.refresh('refresh-1');

    expect(mockPlatformSocialAppService.getDecryptedApp).toHaveBeenCalledWith(
      SocialPlatform.YOUTUBE,
    );
    expect(mockYoutubeApi.refreshAccessToken).toHaveBeenCalledWith(
      'refresh-1',
      app,
      'secret',
    );
    expect(result).toEqual({
      accessToken: 'access-2',
      refreshToken: undefined,
      expiresInSeconds: 3600,
    });
  });

  it('throws when the YouTube platform app is not registered', async () => {
    mockPlatformSocialAppService.getDecryptedApp.mockResolvedValue(null);

    await expect(refresher.refresh('refresh-1')).rejects.toThrow(
      'YouTube platform app is not registered',
    );
    expect(mockYoutubeApi.refreshAccessToken).not.toHaveBeenCalled();
  });
});
