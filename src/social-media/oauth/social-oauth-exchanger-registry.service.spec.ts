import { Test, TestingModule } from '@nestjs/testing';
import { SocialOAuthExchangerRegistry } from './social-oauth-exchanger-registry.service';
import { NoExchangerAvailable } from './no-exchanger-available';
import { FacebookOAuthExchanger } from './facebook-oauth-exchanger';
import { InstagramOAuthExchanger } from './instagram-oauth-exchanger';
import { YouTubeOAuthExchanger } from './youtube-oauth-exchanger';
import { SocialPlatform } from '../enum/social-media.enum';

const mockNoExchangerAvailable = {
  buildAuthorizeUrl: jest.fn(),
  exchangeCode: jest.fn(),
};
const mockFacebookOAuthExchanger = {
  buildAuthorizeUrl: jest.fn(),
  exchangeCode: jest.fn(),
};
const mockInstagramOAuthExchanger = {
  buildAuthorizeUrl: jest.fn(),
  exchangeCode: jest.fn(),
};
const mockYouTubeOAuthExchanger = {
  buildAuthorizeUrl: jest.fn(),
  exchangeCode: jest.fn(),
};

describe('SocialOAuthExchangerRegistry', () => {
  let registry: SocialOAuthExchangerRegistry;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocialOAuthExchangerRegistry,
        { provide: NoExchangerAvailable, useValue: mockNoExchangerAvailable },
        {
          provide: FacebookOAuthExchanger,
          useValue: mockFacebookOAuthExchanger,
        },
        {
          provide: InstagramOAuthExchanger,
          useValue: mockInstagramOAuthExchanger,
        },
        { provide: YouTubeOAuthExchanger, useValue: mockYouTubeOAuthExchanger },
      ],
    }).compile();
    registry = module.get(SocialOAuthExchangerRegistry);
  });

  it('resolves FACEBOOK to FacebookOAuthExchanger', () => {
    expect(registry.resolve(SocialPlatform.FACEBOOK)).toBe(
      mockFacebookOAuthExchanger,
    );
  });

  it('resolves INSTAGRAM to InstagramOAuthExchanger', () => {
    expect(registry.resolve(SocialPlatform.INSTAGRAM)).toBe(
      mockInstagramOAuthExchanger,
    );
  });

  it('resolves YOUTUBE to YouTubeOAuthExchanger', () => {
    expect(registry.resolve(SocialPlatform.YOUTUBE)).toBe(
      mockYouTubeOAuthExchanger,
    );
  });

  it('resolves a platform with no real exchanger yet to NoExchangerAvailable', () => {
    expect(registry.resolve(SocialPlatform.X)).toBe(mockNoExchangerAvailable);
  });
});
