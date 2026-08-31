import { Test, TestingModule } from '@nestjs/testing';
import { FacebookOAuthExchanger } from './facebook-oauth-exchanger';
import { MetaGraphApiService } from '../platform/meta/meta-graph-api.service';
import { SocialPlatformApp } from '../../platform-admin/entity/social-platform-app.entity';
import { SocialPlatform } from '../enum/social-media.enum';

const mockGraphApi = {
  buildAuthorizeUrl: jest.fn(),
  resolvePageAccessToken: jest.fn(),
};

const app: SocialPlatformApp = {
  platform: SocialPlatform.FACEBOOK,
  clientId: 'client-1',
  clientSecretEncrypted: 'irrelevant',
  redirectUri:
    'https://api.discuva.org/v1/integrations/social/FACEBOOK/oauth/callback',
  scopes: 'pages_show_list,pages_manage_posts',
  configId: null,
  isActive: true,
};

describe('FacebookOAuthExchanger', () => {
  let exchanger: FacebookOAuthExchanger;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacebookOAuthExchanger,
        { provide: MetaGraphApiService, useValue: mockGraphApi },
      ],
    }).compile();
    exchanger = module.get(FacebookOAuthExchanger);
  });

  it('delegates buildAuthorizeUrl to MetaGraphApiService', () => {
    mockGraphApi.buildAuthorizeUrl.mockReturnValue(
      'https://facebook.com/dialog/oauth?...',
    );
    const url = exchanger.buildAuthorizeUrl(app, 'state-1');
    expect(mockGraphApi.buildAuthorizeUrl).toHaveBeenCalledWith(app, 'state-1');
    expect(url).toBe('https://facebook.com/dialog/oauth?...');
  });

  it('exchangeCode resolves the Page and returns its token as externalAccountId', async () => {
    mockGraphApi.resolvePageAccessToken.mockResolvedValue({
      pageId: 'page-1',
      pageName: 'Grace Chapel',
      pageAccessToken: 'page-token',
    });

    const result = await exchanger.exchangeCode('code-1', app, 'secret');

    expect(mockGraphApi.resolvePageAccessToken).toHaveBeenCalledWith(
      'code-1',
      app,
      'secret',
    );
    expect(result).toEqual({
      accessToken: 'page-token',
      externalAccountId: 'page-1',
      scope: app.scopes,
    });
    // No expiresInSeconds/refreshToken — a Page token obtained this way
    // doesn't expire and Meta issues no refresh_token for it.
    expect(result.expiresInSeconds).toBeUndefined();
    expect(result.refreshToken).toBeUndefined();
  });
});
