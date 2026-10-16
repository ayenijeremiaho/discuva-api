import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TenantYoutubeIntegrationService } from './tenant-youtube-integration.service';
import { TenantYoutubeIntegration } from '../entity/tenant-youtube-integration.entity';
import { EncryptionService } from '../../../utility/service/encryption.service';
import { YoutubeSubscriptionService } from './youtube-subscription.service';

import { YoutubeChannelCheckService } from './youtube-channel-check.service';

const mockIntegrationRepo = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

const mockEncryptionService = {
  encrypt: jest.fn((v: string) => `enc(${v})`),
  decrypt: jest.fn((v: string) => v.replace(/^enc\((.*)\)$/, '$1')),
};

// YouTube answers with the real channel ID and its name; a link or @handle resolves to the ID.
const mockChannelCheck = {
  check: jest.fn((input: string) =>
    Promise.resolve({
      channelId: input.startsWith('@') ? 'UC-from-handle' : input,
      channelTitle: 'Grace Chapel',
    }),
  ),
};

const mockSubscriptionService = {
  subscribe: jest.fn().mockResolvedValue(undefined),
  unsubscribe: jest.fn().mockResolvedValue(undefined),
};

const mockCls = {
  get: jest.fn().mockReturnValue('tenant-1'),
};

describe('TenantYoutubeIntegrationService', () => {
  let service: TenantYoutubeIntegrationService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCls.get.mockReturnValue('tenant-1');
    mockIntegrationRepo.create.mockImplementation((v) => v);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantYoutubeIntegrationService,
        { provide: ClsService, useValue: mockCls },
        { provide: EncryptionService, useValue: mockEncryptionService },
        {
          provide: YoutubeSubscriptionService,
          useValue: mockSubscriptionService,
        },
        { provide: YoutubeChannelCheckService, useValue: mockChannelCheck },
        {
          provide: getRepositoryToken(TenantYoutubeIntegration),
          useValue: mockIntegrationRepo,
        },
      ],
    }).compile();
    service = module.get(TenantYoutubeIntegrationService);
  });

  describe('tenant context guard', () => {
    it('throws when called with no tenant in CLS', async () => {
      mockCls.get.mockReturnValue(undefined);
      await expect(service.get()).rejects.toThrow(ForbiddenException);
    });
  });

  describe('get', () => {
    it('returns null when this tenant has no integration configured', async () => {
      mockIntegrationRepo.findOne.mockResolvedValue(null);
      expect(await service.get()).toBeNull();
    });

    it('returns a summary without ever exposing the encrypted key itself', async () => {
      mockIntegrationRepo.findOne.mockResolvedValue({
        channelId: 'UC123',
        apiKeyEncrypted: 'enc(secret)',
        isActive: true,
        subscriptionExpiresAt: null,
      });

      const result = await service.get();

      expect(result).toEqual({
        channelId: 'UC123',
        channelTitle: null,
        hasOwnApiKey: true,
        isActive: true,
        status: 'ANNOUNCING',
        subscriptionExpiresAt: null,
      });
    });

    it("says plainly when nothing is being announced for lack of a key, or because it's paused", async () => {
      mockIntegrationRepo.findOne.mockResolvedValueOnce({
        channelId: 'UC123',
        apiKeyEncrypted: null,
        isActive: true,
        subscriptionExpiresAt: null,
      });
      expect((await service.get())?.status).toBe('NEEDS_API_KEY');
      mockIntegrationRepo.findOne.mockResolvedValueOnce({
        channelId: 'UC123',
        apiKeyEncrypted: 'enc(k)',
        isActive: false,
        subscriptionExpiresAt: null,
      });
      expect((await service.get())?.status).toBe('PAUSED');
    });
  });

  describe('upsert', () => {
    // findOne is called first for this church's saved integration, then for anyone else owning the channel.
    it('checks the channel and key with YouTube, then saves the key encrypted and subscribes', async () => {
      mockIntegrationRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      mockIntegrationRepo.save.mockResolvedValue({});

      const result = await service.upsert({
        channelId: '@gracechapel',
        apiKey: ' my-key ',
      });

      expect(mockChannelCheck.check).toHaveBeenCalledWith(
        '@gracechapel',
        'my-key',
      );
      expect(mockIntegrationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          channelId: 'UC-from-handle',
          channelTitle: 'Grace Chapel',
          apiKeyEncrypted: 'enc(my-key)',
          isActive: true,
        }),
      );
      expect(mockSubscriptionService.subscribe).toHaveBeenCalledWith(
        'UC-from-handle',
      );
      expect(result).toEqual(
        expect.objectContaining({
          channelTitle: 'Grace Chapel',
          hasOwnApiKey: true,
          status: 'ANNOUNCING',
        }),
      );
    });

    it('refuses to connect without a key, since there is no platform key to fall back on', async () => {
      mockIntegrationRepo.findOne.mockResolvedValue(null);

      await expect(service.upsert({ channelId: 'UC123' })).rejects.toThrow(
        'Add your YouTube API key',
      );
      expect(mockChannelCheck.check).not.toHaveBeenCalled();
      expect(mockIntegrationRepo.save).not.toHaveBeenCalled();
    });

    it('keeps the saved key when the field is left blank on an edit', async () => {
      const saved = {
        id: 'i1',
        tenantId: 'tenant-1',
        channelId: 'UC123',
        apiKeyEncrypted: 'enc(old-key)',
        isActive: true,
      };
      mockIntegrationRepo.findOne
        .mockResolvedValueOnce(saved)
        .mockResolvedValueOnce(saved);
      mockIntegrationRepo.save.mockResolvedValue({});

      await service.upsert({ channelId: 'UC123' });

      expect(mockChannelCheck.check).toHaveBeenCalledWith('UC123', 'old-key');
      expect(mockEncryptionService.encrypt).not.toHaveBeenCalled();
      expect(mockIntegrationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ apiKeyEncrypted: 'enc(old-key)' }),
      );
    });

    it('saves nothing when YouTube rejects the key or channel', async () => {
      mockIntegrationRepo.findOne.mockResolvedValue(null);
      mockChannelCheck.check.mockRejectedValueOnce(
        new BadRequestException("That API key isn't valid."),
      );

      await expect(
        service.upsert({ channelId: 'UC123', apiKey: 'bad' }),
      ).rejects.toThrow("That API key isn't valid.");
      expect(mockIntegrationRepo.save).not.toHaveBeenCalled();
      expect(mockSubscriptionService.subscribe).not.toHaveBeenCalled();
    });

    it('unsubscribes the old channel before subscribing the new one when switching channels', async () => {
      mockIntegrationRepo.findOne
        .mockResolvedValueOnce({
          tenantId: 'tenant-1',
          channelId: 'UC-old',
          apiKeyEncrypted: 'enc(k)',
        })
        .mockResolvedValueOnce(null);
      mockIntegrationRepo.save.mockResolvedValue({});

      await service.upsert({ channelId: 'UC-new' });

      expect(mockSubscriptionService.unsubscribe).toHaveBeenCalledWith(
        'UC-old',
      );
      expect(mockSubscriptionService.subscribe).toHaveBeenCalledWith('UC-new');
    });

    it('rejects a channel already registered to a different church', async () => {
      mockIntegrationRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          tenantId: 'some-other-tenant',
          channelId: 'UC123',
        });

      await expect(
        service.upsert({ channelId: 'UC123', apiKey: 'k' }),
      ).rejects.toThrow(ConflictException);
      expect(mockIntegrationRepo.save).not.toHaveBeenCalled();
      expect(mockSubscriptionService.subscribe).not.toHaveBeenCalled();
    });
  });

  describe('test', () => {
    it('checks with YouTube using the typed key, or the saved one, and saves nothing', async () => {
      mockIntegrationRepo.findOne.mockResolvedValue({
        tenantId: 'tenant-1',
        apiKeyEncrypted: 'enc(saved-key)',
      });

      await expect(service.test({ channelId: 'UC123' })).resolves.toEqual({
        channelId: 'UC123',
        channelTitle: 'Grace Chapel',
      });
      expect(mockChannelCheck.check).toHaveBeenLastCalledWith(
        'UC123',
        'saved-key',
      );
      await service.test({ channelId: 'UC123', apiKey: 'new-key' });
      expect(mockChannelCheck.check).toHaveBeenLastCalledWith(
        'UC123',
        'new-key',
      );
      expect(mockIntegrationRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('setActive', () => {
    it('throws when no integration has been configured yet', async () => {
      mockIntegrationRepo.findOne.mockResolvedValue(null);
      await expect(service.setActive(true)).rejects.toThrow(NotFoundException);
    });

    it('re-subscribes when enabling', async () => {
      mockIntegrationRepo.findOne.mockResolvedValue({
        tenantId: 'tenant-1',
        channelId: 'UC123',
        isActive: false,
      });
      mockIntegrationRepo.save.mockResolvedValue({});

      await service.setActive(true);

      expect(mockSubscriptionService.subscribe).toHaveBeenCalledWith('UC123');
      expect(mockSubscriptionService.unsubscribe).not.toHaveBeenCalled();
    });

    it('unsubscribes when disabling', async () => {
      mockIntegrationRepo.findOne.mockResolvedValue({
        tenantId: 'tenant-1',
        channelId: 'UC123',
        isActive: true,
      });
      mockIntegrationRepo.save.mockResolvedValue({});

      await service.setActive(false);

      expect(mockSubscriptionService.unsubscribe).toHaveBeenCalledWith('UC123');
      expect(mockSubscriptionService.subscribe).not.toHaveBeenCalled();
    });

    it('reports hasOwnApiKey correctly even though apiKeyEncrypted is select:false by default', async () => {
      mockIntegrationRepo.findOne.mockResolvedValue({
        tenantId: 'tenant-1',
        channelId: 'UC123',
        apiKeyEncrypted: 'enc(secret)',
        isActive: false,
      });
      mockIntegrationRepo.save.mockResolvedValue({});

      const result = await service.setActive(true);

      expect(mockIntegrationRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({ apiKeyEncrypted: true }),
        }),
      );
      expect(result.hasOwnApiKey).toBe(true);
    });
  });
});
