import { Test, TestingModule } from '@nestjs/testing';
import { SocialStatsFetcherRegistry } from './social-stats-fetcher-registry.service';
import { NoStatsAvailable } from './no-stats-available';
import { YouTubeStatsFetcher } from './youtube-stats-fetcher';
import { SocialPlatform } from '../enum/social-media.enum';

const mockNoStatsAvailable = { getStats: jest.fn() };
const mockYouTubeStatsFetcher = { getStats: jest.fn() };

describe('SocialStatsFetcherRegistry', () => {
  let registry: SocialStatsFetcherRegistry;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocialStatsFetcherRegistry,
        { provide: NoStatsAvailable, useValue: mockNoStatsAvailable },
        { provide: YouTubeStatsFetcher, useValue: mockYouTubeStatsFetcher },
      ],
    }).compile();
    registry = module.get(SocialStatsFetcherRegistry);
  });

  it('resolves YOUTUBE to YouTubeStatsFetcher', () => {
    expect(registry.resolve(SocialPlatform.YOUTUBE)).toBe(
      mockYouTubeStatsFetcher,
    );
  });

  it('resolves a platform with no real fetcher yet to NoStatsAvailable', () => {
    expect(registry.resolve(SocialPlatform.FACEBOOK)).toBe(
      mockNoStatsAvailable,
    );
  });
});
