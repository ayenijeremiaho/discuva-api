import { Test, TestingModule } from '@nestjs/testing';
import { YouTubeOAuthExchanger } from './youtube-oauth-exchanger';
import { YouTubeApiService } from '../platform/youtube/youtube-api.service';
import { SocialPlatformApp } from '../../platform-admin/entity/social-platform-app.entity';
import { SocialPlatform } from '../enum/social-media.enum';

const mockYoutubeApi = {
  buildAuthorizeUrl: jest.fn(),
  exchangeCode: jest.fn(),
  resolveChannel: jest.fn(),
};

const app: SocialPlatformApp = {
  platform: SocialPlatform.YOUTUBE,
  clientId: 'client-1',
  clientSecretEncrypted: 'irrelevant',
  redirectUri:
    'https://api.discuva.org/v1/integrations/social/YOUTUBE/oauth/callback',
  scopes: 'https://www.googleapis.com/auth/youtube.upload',
  isActive: true,
};

describe('YouTubeOAuthExchanger', () => {
  let exchanger: YouTubeOAuthExchanger;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        YouTubeOAuthExchanger,
        { provide: YouTubeApiService, useValue: mockYoutubeApi },
      ],
    }).compile();
    exchanger = module.get(YouTubeOAuthExchanger);
  });

  it('delegates buildAuthorizeUrl to YouTubeApiService', () => {
    mockYoutubeApi.buildAuthorizeUrl.mockReturnValue(
      'https://accounts.google.com/...',
    );
    const url = exchanger.buildAuthorizeUrl(app, 'state-1');
    expect(mockYoutubeApi.buildAuthorizeUrl).toHaveBeenCalledWith(
      app,
      'state-1',
    );
    expect(url).toBe('https://accounts.google.com/...');
  });

  it('exchangeCode resolves the channel and carries the refresh token/expiry through', async () => {
    mockYoutubeApi.exchangeCode.mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresInSeconds: 3600,
    });
    mockYoutubeApi.resolveChannel.mockResolvedValue({
      channelId: 'chan-1',
      channelTitle: 'Grace Chapel',
    });

    const result = await exchanger.exchangeCode('code-1', app, 'secret');

    expect(mockYoutubeApi.resolveChannel).toHaveBeenCalledWith('access-1');
    expect(result).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresInSeconds: 3600,
      externalAccountId: 'chan-1',
      scope: app.scopes,
    });
  });
});
