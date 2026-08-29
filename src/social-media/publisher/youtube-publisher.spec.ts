import { Test, TestingModule } from '@nestjs/testing';
import { YouTubePublisher } from './youtube-publisher';
import { SocialTokenResolverService } from '../service/social-token-resolver.service';
import { YouTubeApiService } from '../platform/youtube/youtube-api.service';
import { SocialAccount } from '../entity/social-account.entity';
import { SocialPlacement, SocialPlatform } from '../enum/social-media.enum';

const mockTokenResolver = { getValidAccessToken: jest.fn() };
const mockYoutubeApi = { publishVideo: jest.fn() };

function account(overrides: Partial<SocialAccount> = {}): SocialAccount {
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
    ...overrides,
  } as SocialAccount;
}

const content = 'Sunday highlights';
const media: any[] = [];

describe('YouTubePublisher', () => {
  let publisher: YouTubePublisher;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        YouTubePublisher,
        { provide: SocialTokenResolverService, useValue: mockTokenResolver },
        { provide: YouTubeApiService, useValue: mockYoutubeApi },
      ],
    }).compile();
    publisher = module.get(YouTubePublisher);
  });

  it('publishes and returns the externalPostId on success', async () => {
    mockTokenResolver.getValidAccessToken.mockResolvedValue('access-1');
    mockYoutubeApi.publishVideo.mockResolvedValue('yt-video-1');

    const result = await publisher.publish(
      account(),
      content,
      media,
      SocialPlacement.FEED,
    );

    expect(mockYoutubeApi.publishVideo).toHaveBeenCalledWith(
      'access-1',
      'Sunday highlights',
      [],
      SocialPlacement.FEED,
    );
    expect(result).toEqual({ success: true, externalPostId: 'yt-video-1' });
  });

  it('returns a failure result instead of throwing when no externalAccountId is on record', async () => {
    const result = await publisher.publish(
      account({ externalAccountId: null }),
      content,
      media,
      SocialPlacement.FEED,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('reconnect');
    expect(mockYoutubeApi.publishVideo).not.toHaveBeenCalled();
  });

  it('returns a failure result instead of throwing when the token resolver rejects', async () => {
    mockTokenResolver.getValidAccessToken.mockRejectedValue(
      new Error(
        'YOUTUBE access token has expired and no refresh token is available — reconnect the account.',
      ),
    );

    const result = await publisher.publish(
      account(),
      content,
      media,
      SocialPlacement.FEED,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('reconnect the account');
  });

  it('returns a failure result instead of throwing when the upload itself fails', async () => {
    mockTokenResolver.getValidAccessToken.mockResolvedValue('access-1');
    mockYoutubeApi.publishVideo.mockRejectedValue(
      new Error('YouTube requires a video attachment.'),
    );

    const result = await publisher.publish(
      account(),
      content,
      media,
      SocialPlacement.FEED,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('requires a video attachment');
  });
});
