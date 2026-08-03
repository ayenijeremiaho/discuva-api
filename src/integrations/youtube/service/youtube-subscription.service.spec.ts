import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { YoutubeSubscriptionService } from './youtube-subscription.service';
import { TenantYoutubeIntegration } from '../entity/tenant-youtube-integration.entity';

const mockIntegrationRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

function mockConfig(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string) => values[key]),
  };
}

const CONFIGURED = {
  YOUTUBE_WEBSUB_CALLBACK_URL:
    'https://api.example.com/integrations/youtube/callback',
  YOUTUBE_WEBSUB_SECRET: 'shh-secret',
};

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
          provide: getRepositoryToken(TenantYoutubeIntegration),
          useValue: mockIntegrationRepo,
        },
      ],
    }).compile();
    service = module.get(YoutubeSubscriptionService);
  }

  describe('isWebSubConfigured', () => {
    it('returns false when the callback url or secret is missing', async () => {
      await build({});
      expect(service.isWebSubConfigured()).toBe(false);
    });

    it('returns true when both callback url and secret are set — no channel id required at this level', async () => {
      await build(CONFIGURED);
      expect(service.isWebSubConfigured()).toBe(true);
    });
  });

  describe('subscribe', () => {
    it('skips the WebSub request entirely when not configured at the platform level', async () => {
      await build({});
      const fetchSpy = jest.spyOn(global, 'fetch');

      await service.subscribe('UC123');

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mockIntegrationRepo.save).not.toHaveBeenCalled();
    });

    it('posts a subscribe request for the given channel and persists the new lease', async () => {
      await build(CONFIGURED);
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 202,
      } as Response);
      mockIntegrationRepo.findOne.mockResolvedValue({ channelId: 'UC123' });
      mockIntegrationRepo.save.mockResolvedValue({});

      await service.subscribe('UC123');

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://pubsubhubbub.appspot.com/subscribe',
        expect.objectContaining({ method: 'POST' }),
      );
      const [, options] = fetchSpy.mock.calls[0];
      expect(String(options?.body)).toContain('hub.secret=shh-secret');
      expect(String(options?.body)).toContain('hub.mode=subscribe');
      expect(mockIntegrationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ subscriptionExpiresAt: expect.any(Date) }),
      );
    });

    it('does not persist state when the hub rejects the request', async () => {
      await build(CONFIGURED);
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 400,
      } as Response);

      await service.subscribe('UC123');

      expect(mockIntegrationRepo.save).not.toHaveBeenCalled();
    });

    it('swallows network errors without throwing', async () => {
      await build(CONFIGURED);
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

      await expect(service.subscribe('UC123')).resolves.toBeUndefined();
    });

    it('silently no-ops when no integration row exists yet for the channel (nothing to update)', async () => {
      await build(CONFIGURED);
      jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
      mockIntegrationRepo.findOne.mockResolvedValue(null);

      await expect(service.subscribe('UC-unknown')).resolves.toBeUndefined();
      expect(mockIntegrationRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    it('posts an unsubscribe request and clears the lease', async () => {
      await build(CONFIGURED);
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
      } as Response);
      mockIntegrationRepo.findOne.mockResolvedValue({
        channelId: 'UC123',
        subscriptionExpiresAt: new Date(),
      });
      mockIntegrationRepo.save.mockResolvedValue({});

      await service.unsubscribe('UC123');

      const [, options] = fetchSpy.mock.calls[0];
      expect(String(options?.body)).toContain('hub.mode=unsubscribe');
      expect(mockIntegrationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ subscriptionExpiresAt: null }),
      );
    });
  });

  describe('renewAllActive', () => {
    it('subscribes every active integration', async () => {
      await build(CONFIGURED);
      mockIntegrationRepo.find.mockResolvedValue([
        { channelId: 'UC1' },
        { channelId: 'UC2' },
      ]);
      jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
      mockIntegrationRepo.findOne.mockResolvedValue({ channelId: 'UC1' });

      await service.renewAllActive();

      expect(mockIntegrationRepo.find).toHaveBeenCalledWith({
        where: { isActive: true },
      });
      const fetchSpy = global.fetch as jest.Mock;
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('does nothing when not configured at the platform level', async () => {
      await build({});
      await service.renewAllActive();
      expect(mockIntegrationRepo.find).not.toHaveBeenCalled();
    });
  });
});
