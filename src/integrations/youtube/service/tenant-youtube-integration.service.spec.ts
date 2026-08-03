import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TenantYoutubeIntegrationService } from './tenant-youtube-integration.service';
import { TenantYoutubeIntegration } from '../entity/tenant-youtube-integration.entity';
import { EncryptionService } from '../../../utility/service/encryption.service';
import { YoutubeSubscriptionService } from './youtube-subscription.service';

const mockIntegrationRepo = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

const mockEncryptionService = {
  encrypt: jest.fn((v: string) => `enc(${v})`),
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
        hasOwnApiKey: true,
        isActive: true,
        subscriptionExpiresAt: null,
      });
    });
  });

  describe('upsert', () => {
    it('creates a new integration, encrypts the api key, and subscribes', async () => {
      mockIntegrationRepo.findOne
        .mockResolvedValueOnce(null) // no existing config for this channel (conflict check)
        .mockResolvedValueOnce(null); // no existing config for this tenant
      mockIntegrationRepo.save.mockResolvedValue({});

      const result = await service.upsert({
        channelId: 'UC123',
        apiKey: 'my-key',
      });

      expect(mockEncryptionService.encrypt).toHaveBeenCalledWith('my-key');
      expect(mockIntegrationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          channelId: 'UC123',
          apiKeyEncrypted: 'enc(my-key)',
          isActive: true,
        }),
      );
      expect(mockSubscriptionService.subscribe).toHaveBeenCalledWith('UC123');
      expect(mockSubscriptionService.unsubscribe).not.toHaveBeenCalled();
      expect(result.channelId).toBe('UC123');
      expect(result.hasOwnApiKey).toBe(true);
    });

    it('stores no api key when omitted — platform default applies at send time', async () => {
      mockIntegrationRepo.findOne.mockResolvedValue(null);
      mockIntegrationRepo.save.mockResolvedValue({});

      const result = await service.upsert({ channelId: 'UC123' });

      expect(mockEncryptionService.encrypt).not.toHaveBeenCalled();
      expect(result.hasOwnApiKey).toBe(false);
    });

    it('unsubscribes the old channel before subscribing the new one when switching channels', async () => {
      mockIntegrationRepo.findOne
        .mockResolvedValueOnce(null) // no conflicting owner for the new channel
        .mockResolvedValueOnce({ tenantId: 'tenant-1', channelId: 'UC-old' });
      mockIntegrationRepo.save.mockResolvedValue({});

      await service.upsert({ channelId: 'UC-new' });

      expect(mockSubscriptionService.unsubscribe).toHaveBeenCalledWith(
        'UC-old',
      );
      expect(mockSubscriptionService.subscribe).toHaveBeenCalledWith('UC-new');
    });

    it('rejects a channel id already registered to a different tenant', async () => {
      mockIntegrationRepo.findOne.mockResolvedValueOnce({
        tenantId: 'some-other-tenant',
        channelId: 'UC123',
      });

      await expect(service.upsert({ channelId: 'UC123' })).rejects.toThrow(
        ConflictException,
      );
      expect(mockIntegrationRepo.save).not.toHaveBeenCalled();
      expect(mockSubscriptionService.subscribe).not.toHaveBeenCalled();
    });

    it('allows re-saving the same channel already owned by this tenant (no conflict with self)', async () => {
      mockIntegrationRepo.findOne
        .mockResolvedValueOnce({ tenantId: 'tenant-1', channelId: 'UC123' })
        .mockResolvedValueOnce({ tenantId: 'tenant-1', channelId: 'UC123' });
      mockIntegrationRepo.save.mockResolvedValue({});

      await expect(
        service.upsert({ channelId: 'UC123' }),
      ).resolves.toBeDefined();
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
