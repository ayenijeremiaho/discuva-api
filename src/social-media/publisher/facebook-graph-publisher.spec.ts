import { Test, TestingModule } from '@nestjs/testing';
import { FacebookGraphPublisher } from './facebook-graph-publisher';
import { SocialTokenResolverService } from '../service/social-token-resolver.service';
import { MetaGraphApiService } from '../platform/meta/meta-graph-api.service';
import { SocialAccount } from '../entity/social-account.entity';
import { SocialPlacement, SocialPlatform } from '../enum/social-media.enum';

const mockTokenResolver = { getValidAccessToken: jest.fn() };
const mockGraphApi = { publishToFacebookPage: jest.fn() };

function account(overrides: Partial<SocialAccount> = {}): SocialAccount {
  return {
    id: 'account-1',
    platform: SocialPlatform.FACEBOOK,
    displayName: 'Grace Chapel',
    externalAccountId: 'page-1',
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

describe('FacebookGraphPublisher', () => {
  let publisher: FacebookGraphPublisher;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacebookGraphPublisher,
        { provide: SocialTokenResolverService, useValue: mockTokenResolver },
        { provide: MetaGraphApiService, useValue: mockGraphApi },
      ],
    }).compile();
    publisher = module.get(FacebookGraphPublisher);
  });

  it('publishes and returns the externalPostId on success', async () => {
    mockTokenResolver.getValidAccessToken.mockResolvedValue('page-token');
    mockGraphApi.publishToFacebookPage.mockResolvedValue('post-1-external');

    const result = await publisher.publish(
      account(),
      content,
      media,
      SocialPlacement.FEED,
    );

    expect(mockGraphApi.publishToFacebookPage).toHaveBeenCalledWith(
      'page-1',
      'page-token',
      'Hello church',
      [],
      SocialPlacement.FEED,
    );
    expect(result).toEqual({
      success: true,
      externalPostId: 'post-1-external',
    });
  });

  it('passes the target placement straight through to MetaGraphApiService', async () => {
    mockTokenResolver.getValidAccessToken.mockResolvedValue('page-token');
    mockGraphApi.publishToFacebookPage.mockRejectedValue(
      new Error(
        "Facebook STORY publishing isn't implemented yet — only FEED is supported.",
      ),
    );

    const result = await publisher.publish(
      account(),
      content,
      media,
      SocialPlacement.STORY,
    );

    expect(mockGraphApi.publishToFacebookPage).toHaveBeenCalledWith(
      'page-1',
      'page-token',
      'Hello church',
      [],
      SocialPlacement.STORY,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('only FEED is supported');
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
    expect(mockGraphApi.publishToFacebookPage).not.toHaveBeenCalled();
  });

  it('returns a failure result instead of throwing when the token resolver rejects', async () => {
    mockTokenResolver.getValidAccessToken.mockRejectedValue(
      new Error('FACEBOOK account is not connected — no access token stored.'),
    );

    const result = await publisher.publish(
      account(),
      content,
      media,
      SocialPlacement.FEED,
    );

    expect(result).toEqual({
      success: false,
      error: 'FACEBOOK account is not connected — no access token stored.',
    });
  });

  it('returns a failure result instead of throwing when the Graph API call rejects', async () => {
    mockTokenResolver.getValidAccessToken.mockResolvedValue('page-token');
    mockGraphApi.publishToFacebookPage.mockRejectedValue(
      new Error('Meta Graph API request failed.'),
    );

    const result = await publisher.publish(
      account(),
      content,
      media,
      SocialPlacement.FEED,
    );

    expect(result).toEqual({
      success: false,
      error: 'Meta Graph API request failed.',
    });
  });
});
