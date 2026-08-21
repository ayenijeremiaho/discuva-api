import { Test, TestingModule } from '@nestjs/testing';
import { SocialPublisherRegistry } from './social-publisher-registry.service';
import { NotConnectedPublisher } from './not-connected-publisher';
import { PlatformDisabledPublisher } from './platform-disabled-publisher';
import { PlatformSocialAppService } from '../../platform-admin/service/platform-social-app.service';
import { SocialPlatform } from '../enum/social-media.enum';

const mockNotConnectedPublisher = { publish: jest.fn() };
const mockPlatformDisabledPublisher = { publish: jest.fn() };
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
          provide: PlatformSocialAppService,
          useValue: mockPlatformSocialAppService,
        },
      ],
    }).compile();
    registry = module.get(SocialPublisherRegistry);
  });

  it('resolves to the registered publisher when the platform is not disabled', async () => {
    const result = await registry.resolve(SocialPlatform.FACEBOOK);
    expect(
      mockPlatformSocialAppService.isPlatformDisabled,
    ).toHaveBeenCalledWith(SocialPlatform.FACEBOOK);
    expect(result).toBe(mockNotConnectedPublisher);
  });

  it('resolves to PlatformDisabledPublisher when the platform-admin kill switch is off', async () => {
    mockPlatformSocialAppService.isPlatformDisabled.mockResolvedValue(true);
    const result = await registry.resolve(SocialPlatform.YOUTUBE);
    expect(result).toBe(mockPlatformDisabledPublisher);
  });
});
