import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { YoutubeSubscriptionService } from './youtube-subscription.service';
import { YoutubeIntegrationState } from '../entity/youtube-integration-state.entity';

const mockStateRepo = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

function mockConfig(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string) => values[key]),
  };
}

describe('YoutubeSubscriptionService', () => {
  let service: YoutubeSubscriptionService;

  beforeEach(async () => {
    jest.clearAllMocks();
  });

  async function build(configValues: Record<string, string | undefined>) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        YoutubeSubscriptionService,
        { provide: ConfigService, useValue: mockConfig(configValues) },
        {
          provide: getRepositoryToken(YoutubeIntegrationState),
          useValue: mockStateRepo,
        },
      ],
    }).compile();
    service = module.get(YoutubeSubscriptionService);
  }

  describe('isConfigured', () => {
    it('returns false when channel id or callback url is missing', async () => {
      await build({});
      expect(service.isConfigured()).toBe(false);
    });

    it('returns true when both are set', async () => {
      await build({
        YOUTUBE_CHANNEL_ID: 'UC123',
        YOUTUBE_WEBSUB_CALLBACK_URL:
          'https://api.example.com/integrations/youtube/callback',
      });
      expect(service.isConfigured()).toBe(true);
    });
  });

  describe('subscribe', () => {
    it('skips the WebSub request entirely when not configured', async () => {
      await build({});
      const fetchSpy = jest.spyOn(global, 'fetch');

      await service.subscribe();

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mockStateRepo.save).not.toHaveBeenCalled();
    });

    it('posts a subscribe request and persists the new lease when configured', async () => {
      await build({
        YOUTUBE_CHANNEL_ID: 'UC123',
        YOUTUBE_WEBSUB_CALLBACK_URL:
          'https://api.example.com/integrations/youtube/callback',
      });
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 202,
      } as Response);
      mockStateRepo.findOne.mockResolvedValue(null);
      mockStateRepo.create.mockImplementation((v) => v);
      mockStateRepo.save.mockResolvedValue({});

      await service.subscribe();

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://pubsubhubbub.appspot.com/subscribe',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(mockStateRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ channelId: 'UC123' }),
      );
      expect(mockStateRepo.save).toHaveBeenCalled();
    });

    it('does not persist state when the hub rejects the request', async () => {
      await build({
        YOUTUBE_CHANNEL_ID: 'UC123',
        YOUTUBE_WEBSUB_CALLBACK_URL:
          'https://api.example.com/integrations/youtube/callback',
      });
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 400,
      } as Response);

      await service.subscribe();

      expect(mockStateRepo.save).not.toHaveBeenCalled();
    });

    it('swallows network errors without throwing', async () => {
      await build({
        YOUTUBE_CHANNEL_ID: 'UC123',
        YOUTUBE_WEBSUB_CALLBACK_URL:
          'https://api.example.com/integrations/youtube/callback',
      });
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

      await expect(service.subscribe()).resolves.toBeUndefined();
    });
  });
});
