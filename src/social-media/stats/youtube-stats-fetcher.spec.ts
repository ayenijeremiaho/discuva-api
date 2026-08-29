import { Test, TestingModule } from '@nestjs/testing';
import { YouTubeStatsFetcher } from './youtube-stats-fetcher';
import { SocialTokenResolverService } from '../service/social-token-resolver.service';
import { YouTubeApiService } from '../platform/youtube/youtube-api.service';
import { SocialAccount } from '../entity/social-account.entity';
import { SocialPlatform } from '../enum/social-media.enum';

const mockTokenResolver = { getValidAccessToken: jest.fn() };
const mockYoutubeApi = { getVideoStats: jest.fn() };

function account(): SocialAccount {
  return {
    id: 'account-1',
    platform: SocialPlatform.YOUTUBE,
    displayName: 'Grace Chapel',
    externalAccountId: 'chan-1',
    isConnected: true,
    connectedAt: new Date(),
    connectedBy: null,
    accessTokenEncrypted: 'enc',
    refreshTokenEncrypted: 'enc-refresh',
    tokenExpiresAt: null,
    scope: null,
  } as SocialAccount;
}

describe('YouTubeStatsFetcher', () => {
  let fetcher: YouTubeStatsFetcher;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        YouTubeStatsFetcher,
        { provide: SocialTokenResolverService, useValue: mockTokenResolver },
        { provide: YouTubeApiService, useValue: mockYoutubeApi },
      ],
    }).compile();
    fetcher = module.get(YouTubeStatsFetcher);
  });

  it('resolves a valid access token, then fetches stats for the given video id', async () => {
    mockTokenResolver.getValidAccessToken.mockResolvedValue('access-1');
    mockYoutubeApi.getVideoStats.mockResolvedValue({ viewCount: 100 });

    const result = await fetcher.getStats(account(), 'yt-video-1');

    expect(mockTokenResolver.getValidAccessToken).toHaveBeenCalledWith(
      'account-1',
    );
    expect(mockYoutubeApi.getVideoStats).toHaveBeenCalledWith(
      'yt-video-1',
      'access-1',
    );
    expect(result).toEqual({ viewCount: 100 });
  });
});
