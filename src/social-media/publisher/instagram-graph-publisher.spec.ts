import { Test, TestingModule } from '@nestjs/testing';
import { InstagramGraphPublisher } from './instagram-graph-publisher';
import { SocialTokenResolverService } from '../service/social-token-resolver.service';
import { MetaGraphApiService } from '../platform/meta/meta-graph-api.service';
import { SocialAccount } from '../entity/social-account.entity';
import { SocialPlacement, SocialPlatform } from '../enum/social-media.enum';

const mockTokenResolver = { getValidAccessToken: jest.fn() };
const mockGraphApi = { publishToInstagram: jest.fn() };

function account(overrides: Partial<SocialAccount> = {}): SocialAccount {
  return {
    id: 'account-1',
    platform: SocialPlatform.INSTAGRAM,
    displayName: 'Grace Chapel',
    externalAccountId: 'ig-1',
    isConnected: true,
    connectedAt: new Date(),
    connectedBy: null,
    accessTokenEncrypted: 'enc',
    refreshTokenEncrypted: null,
    tokenExpiresAt: null,
    scope: null,
    ...overrides,
  } as SocialAccount;
}

const content = 'Hello church';
const media: any[] = [];

describe('InstagramGraphPublisher', () => {
  let publisher: InstagramGraphPublisher;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstagramGraphPublisher,
        { provide: SocialTokenResolverService, useValue: mockTokenResolver },
        { provide: MetaGraphApiService, useValue: mockGraphApi },
      ],
    }).compile();
    publisher = module.get(InstagramGraphPublisher);
  });

  it('publishes and returns the externalPostId on success', async () => {
    mockTokenResolver.getValidAccessToken.mockResolvedValue('page-token');
    mockGraphApi.publishToInstagram.mockResolvedValue('media-1');

    const result = await publisher.publish(
      account(),
      content,
      media,
      SocialPlacement.FEED,
    );

    expect(mockGraphApi.publishToInstagram).toHaveBeenCalledWith(
      'ig-1',
      'page-token',
      'Hello church',
      [],
      SocialPlacement.FEED,
    );
    expect(result).toEqual({ success: true, externalPostId: 'media-1' });
  });

  it('passes STORY placement straight through to MetaGraphApiService', async () => {
    mockTokenResolver.getValidAccessToken.mockResolvedValue('page-token');
    mockGraphApi.publishToInstagram.mockResolvedValue('story-media-1');

    const result = await publisher.publish(
      account(),
      content,
      media,
      SocialPlacement.STORY,
    );

    expect(mockGraphApi.publishToInstagram).toHaveBeenCalledWith(
      'ig-1',
      'page-token',
      'Hello church',
      [],
      SocialPlacement.STORY,
    );
    expect(result).toEqual({ success: true, externalPostId: 'story-media-1' });
  });

  it('passes REEL placement straight through to MetaGraphApiService', async () => {
    mockTokenResolver.getValidAccessToken.mockResolvedValue('page-token');
    mockGraphApi.publishToInstagram.mockResolvedValue('reel-media-1');

    const result = await publisher.publish(
      account(),
      content,
      media,
      SocialPlacement.REEL,
    );

    expect(mockGraphApi.publishToInstagram).toHaveBeenCalledWith(
      'ig-1',
      'page-token',
      'Hello church',
      [],
      SocialPlacement.REEL,
    );
    expect(result).toEqual({ success: true, externalPostId: 'reel-media-1' });
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
    expect(mockGraphApi.publishToInstagram).not.toHaveBeenCalled();
  });

  it('returns a failure result instead of throwing when the Graph API call rejects', async () => {
    mockTokenResolver.getValidAccessToken.mockResolvedValue('page-token');
    mockGraphApi.publishToInstagram.mockRejectedValue(
      new Error(
        'Instagram requires an image or video attachment — a text-only post cannot be published.',
      ),
    );

    const result = await publisher.publish(
      account(),
      content,
      media,
      SocialPlacement.FEED,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('requires an image or video');
  });
});
