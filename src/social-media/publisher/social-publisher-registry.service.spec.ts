import { Test, TestingModule } from '@nestjs/testing';
import { SocialPublisherRegistry } from './social-publisher-registry.service';
import { NotConnectedPublisher } from './not-connected-publisher';
import { PlatformDisabledPublisher } from './platform-disabled-publisher';
import { FacebookGraphPublisher } from './facebook-graph-publisher';
import { InstagramGraphPublisher } from './instagram-graph-publisher';
import { YouTubePublisher } from './youtube-publisher';
import { PlatformSocialAppService } from '../../platform-admin/service/platform-social-app.service';
import { SocialPlatform } from '../enum/social-media.enum';

const mockNotConnectedPublisher = { publish: jest.fn() };
const mockPlatformDisabledPublisher = { publish: jest.fn() };
const mockFacebookGraphPublisher = { publish: jest.fn() };
const mockInstagramGraphPublisher = { publish: jest.fn() };
const mockYouTubePublisher = { publish: jest.fn() };
const mockPlatformSocialAppService = { isPlatformDisabled: jest.fn() };

describe('SocialPublisherRegistry', () => {
  let registry: SocialPublisherRegistry;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPlatformSocialAppService.isPlatformDisabled.mockResolvedValue(false);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocialPublisherRegistry,
        { provide: NotConnectedPublisher, useValue: mockNotConnectedPublisher },
        {
          provide: PlatformDisabledPublisher,
          useValue: mockPlatformDisabledPublisher,
        },
        {
          provide: FacebookGraphPublisher,
          useValue: mockFacebookGraphPublisher,
        },
        {
          provide: InstagramGraphPublisher,
          useValue: mockInstagramGraphPublisher,
        },
        {
          provide: YouTubePublisher,
          useValue: mockYouTubePublisher,
        },
        {
          provide: PlatformSocialAppService,
          useValue: mockPlatformSocialAppService,
        },
      ],
    }).compile();
    registry = module.get(SocialPublisherRegistry);
  });

  it('resolves FACEBOOK to FacebookGraphPublisher when the platform is not disabled', async () => {
    const result = await registry.resolve(SocialPlatform.FACEBOOK);
    expect(
      mockPlatformSocialAppService.isPlatformDisabled,
    ).toHaveBeenCalledWith(SocialPlatform.FACEBOOK);
    expect(result).toBe(mockFacebookGraphPublisher);
  });

  it('resolves INSTAGRAM to InstagramGraphPublisher when the platform is not disabled', async () => {
    const result = await registry.resolve(SocialPlatform.INSTAGRAM);
    expect(result).toBe(mockInstagramGraphPublisher);
  });

  it('resolves YOUTUBE to YouTubePublisher when the platform is not disabled', async () => {
    const result = await registry.resolve(SocialPlatform.YOUTUBE);
    expect(result).toBe(mockYouTubePublisher);
  });

  it('resolves a platform with no real publisher yet to NotConnectedPublisher', async () => {
    const result = await registry.resolve(SocialPlatform.TIKTOK);
    expect(result).toBe(mockNotConnectedPublisher);
  });

  it('resolves to PlatformDisabledPublisher when the platform-admin kill switch is off', async () => {
    mockPlatformSocialAppService.isPlatformDisabled.mockResolvedValue(true);
    const result = await registry.resolve(SocialPlatform.FACEBOOK);
    expect(result).toBe(mockPlatformDisabledPublisher);
  });
});
