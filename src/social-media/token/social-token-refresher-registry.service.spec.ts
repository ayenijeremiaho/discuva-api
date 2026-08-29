import { Test, TestingModule } from '@nestjs/testing';
import { SocialTokenRefresherRegistry } from './social-token-refresher-registry.service';
import { NoRefresherAvailable } from './no-refresher-available';
import { YouTubeTokenRefresher } from './youtube-token-refresher';
import { SocialPlatform } from '../enum/social-media.enum';

const mockNoRefresherAvailable = { refresh: jest.fn() };
const mockYouTubeTokenRefresher = { refresh: jest.fn() };

describe('SocialTokenRefresherRegistry', () => {
  let registry: SocialTokenRefresherRegistry;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocialTokenRefresherRegistry,
        { provide: NoRefresherAvailable, useValue: mockNoRefresherAvailable },
        { provide: YouTubeTokenRefresher, useValue: mockYouTubeTokenRefresher },
      ],
    }).compile();
    registry = module.get(SocialTokenRefresherRegistry);
  });

  it('resolves YOUTUBE to YouTubeTokenRefresher — the one platform whose token actually expires', () => {
    expect(registry.resolve(SocialPlatform.YOUTUBE)).toBe(
      mockYouTubeTokenRefresher,
    );
  });

  it('resolves FACEBOOK to NoRefresherAvailable — a Page token does not expire', () => {
    expect(registry.resolve(SocialPlatform.FACEBOOK)).toBe(
      mockNoRefresherAvailable,
    );
  });

  it('resolves a platform with no real refresher yet to NoRefresherAvailable', () => {
    expect(registry.resolve(SocialPlatform.X)).toBe(mockNoRefresherAvailable);
  });
});
