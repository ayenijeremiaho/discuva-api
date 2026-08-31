import { Test, TestingModule } from '@nestjs/testing';
import { InstagramOAuthExchanger } from './instagram-oauth-exchanger';
import { MetaGraphApiService } from '../platform/meta/meta-graph-api.service';
import { SocialPlatformApp } from '../../platform-admin/entity/social-platform-app.entity';
import { SocialPlatform } from '../enum/social-media.enum';

const mockGraphApi = {
  buildAuthorizeUrl: jest.fn(),
  resolvePageAccessToken: jest.fn(),
  getInstagramBusinessAccountId: jest.fn(),
};

const app: SocialPlatformApp = {
  platform: SocialPlatform.INSTAGRAM,
  clientId: 'client-1',
  clientSecretEncrypted: 'irrelevant',
  redirectUri:
    'https://api.discuva.org/v1/integrations/social/INSTAGRAM/oauth/callback',
  scopes: 'instagram_basic,instagram_content_publish',
  configId: null,
  isActive: true,
};

describe('InstagramOAuthExchanger', () => {
  let exchanger: InstagramOAuthExchanger;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstagramOAuthExchanger,
        { provide: MetaGraphApiService, useValue: mockGraphApi },
      ],
    }).compile();
    exchanger = module.get(InstagramOAuthExchanger);
  });

  it('resolves the Page, then the linked IG Business Account, and returns the Page token', async () => {
    mockGraphApi.resolvePageAccessToken.mockResolvedValue({
      pageId: 'page-1',
      pageName: 'Grace Chapel',
      pageAccessToken: 'page-token',
    });
    mockGraphApi.getInstagramBusinessAccountId.mockResolvedValue('ig-1');

    const result = await exchanger.exchangeCode('code-1', app, 'secret');

    expect(mockGraphApi.getInstagramBusinessAccountId).toHaveBeenCalledWith(
      'page-1',
      'page-token',
    );
    expect(result).toEqual({
      accessToken: 'page-token',
      externalAccountId: 'ig-1',
      scope: app.scopes,
    });
  });

  it('propagates the error when the Page has no linked Instagram account', async () => {
    mockGraphApi.resolvePageAccessToken.mockResolvedValue({
      pageId: 'page-1',
      pageName: 'Grace Chapel',
      pageAccessToken: 'page-token',
    });
    mockGraphApi.getInstagramBusinessAccountId.mockRejectedValue(
      new Error('no linked Instagram account'),
    );

    await expect(
      exchanger.exchangeCode('code-1', app, 'secret'),
    ).rejects.toThrow('no linked Instagram account');
  });
});
