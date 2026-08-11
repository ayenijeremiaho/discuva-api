import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';

// AnnouncementService transitively imports SanitizationService, which pulls
// in jsdom — mocked here (as announcement.service.spec.ts does) so this
// spec doesn't need jsdom's ESM-only transitive deps just to get a DI token.
jest.mock('../../../utility/service/sanitization.service', () => ({
  SanitizationService: jest.fn().mockImplementation(() => ({
    sanitize: jest.fn((html: string) => html),
    sanitizeText: jest.fn((text: string) => text),
    sanitizeForEmail: jest.fn((html: string) => html),
  })),
}));

import { YoutubeLiveDetectionService } from './youtube-live-detection.service';
import { TenantYoutubeIntegration } from '../entity/tenant-youtube-integration.entity';
import { Tenant } from '../../../tenant/entity/tenant.entity';
import { AnnouncementService } from '../../../announcement/service/announcement.service';
import { CacheService } from '../../../utility/service/cache.service';
import { EncryptionService } from '../../../utility/service/encryption.service';

const mockIntegrationRepo = {
  findOne: jest.fn(),
  save: jest.fn(),
};

const mockTenantRepo = {
  findOneBy: jest.fn(),
};

const mockAnnouncementService = {
  createSystemAnnouncement: jest.fn().mockResolvedValue({ id: 'ann-1' }),
};

const mockCacheService = {
  acquireLock: jest.fn().mockResolvedValue(true),
  releaseLock: jest.fn(),
};

const mockEncryptionService = {
  decrypt: jest.fn((v: string) => `decrypted(${v})`),
};

// Real runWith/withTransaction set up AsyncLocalStorage + a DB transaction —
// neither of those is what this spec is testing (both are already trusted,
// used the same way elsewhere — e.g. PlatformTenantService.impersonateTenant).
// Just invoking the callback is enough to verify this service enters tenant
// context at all before announcing, which is the thing that's actually new.
const mockCls = {
  runWith: jest.fn((_store: unknown, fn: () => unknown) => fn()),
};
const mockTxHost = {
  tx: { query: jest.fn() },
  withTransaction: jest.fn((fn: () => unknown) => fn()),
};

const mockTenant = {
  id: 'tenant-1',
  schemaName: 'church_test',
};

describe('YoutubeLiveDetectionService', () => {
  let service: YoutubeLiveDetectionService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCacheService.acquireLock.mockResolvedValue(true);
    mockCls.runWith.mockImplementation((_store: unknown, fn: () => unknown) =>
      fn(),
    );
    mockTxHost.withTransaction.mockImplementation((fn: () => unknown) => fn());
    mockTenantRepo.findOneBy.mockResolvedValue(mockTenant);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        YoutubeLiveDetectionService,
        {
          provide: getRepositoryToken(TenantYoutubeIntegration),
          useValue: mockIntegrationRepo,
        },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: AnnouncementService, useValue: mockAnnouncementService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: EncryptionService, useValue: mockEncryptionService },
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
      ],
    }).compile();
    service = module.get(YoutubeLiveDetectionService);
  });

  it('does nothing when videoId is null', async () => {
    await service.handleNotification(null, 'UC123');
    expect(
      mockAnnouncementService.createSystemAnnouncement,
    ).not.toHaveBeenCalled();
  });

  it('does nothing when channelId is null', async () => {
    await service.handleNotification('vid-1', null);
    expect(
      mockAnnouncementService.createSystemAnnouncement,
    ).not.toHaveBeenCalled();
  });

  it('ignores a channel with no active tenant integration', async () => {
    mockIntegrationRepo.findOne.mockResolvedValue(null);
    const fetchSpy = jest.spyOn(global, 'fetch');

    await service.handleNotification('vid-1', 'UC-unknown');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(
      mockAnnouncementService.createSystemAnnouncement,
    ).not.toHaveBeenCalled();
  });

  it('skips already-announced video ids (idempotency)', async () => {
    mockIntegrationRepo.findOne.mockResolvedValue({
      tenantId: 'tenant-1',
      channelId: 'UC123',
      lastAnnouncedVideoId: 'vid-1',
    });
    const fetchSpy = jest.spyOn(global, 'fetch');

    await service.handleNotification('vid-1', 'UC123');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(
      mockAnnouncementService.createSystemAnnouncement,
    ).not.toHaveBeenCalled();
  });

  it("uses the tenant's own decrypted API key when configured", async () => {
    mockIntegrationRepo.findOne.mockResolvedValue({
      tenantId: 'tenant-1',
      channelId: 'UC123',
      apiKeyEncrypted: 'enc-key',
      lastAnnouncedVideoId: null,
    });
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          { snippet: { liveBroadcastContent: 'none', channelId: 'UC123' } },
        ],
      }),
    } as Response);

    await service.handleNotification('vid-2', 'UC123');

    expect(mockEncryptionService.decrypt).toHaveBeenCalledWith('enc-key');
    expect(fetchSpy.mock.calls[0][0]).toContain('key=decrypted(enc-key)');
  });

  it('does nothing when the tenant has no API key configured — no platform-wide fallback', async () => {
    mockIntegrationRepo.findOne.mockResolvedValue({
      tenantId: 'tenant-1',
      channelId: 'UC123',
      apiKeyEncrypted: null,
      lastAnnouncedVideoId: null,
    });
    const fetchSpy = jest.spyOn(global, 'fetch');

    await service.handleNotification('vid-2', 'UC123');

    expect(mockEncryptionService.decrypt).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(
      mockAnnouncementService.createSystemAnnouncement,
    ).not.toHaveBeenCalled();
  });

  it('does not announce when the video is not actually live', async () => {
    mockIntegrationRepo.findOne.mockResolvedValue({
      tenantId: 'tenant-1',
      channelId: 'UC123',
      apiKeyEncrypted: 'enc-key',
      lastAnnouncedVideoId: null,
    });
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            snippet: {
              title: 'Regular upload',
              liveBroadcastContent: 'none',
              channelId: 'UC123',
            },
          },
        ],
      }),
    } as Response);

    await service.handleNotification('vid-2', 'UC123');

    expect(
      mockAnnouncementService.createSystemAnnouncement,
    ).not.toHaveBeenCalled();
    expect(mockIntegrationRepo.save).not.toHaveBeenCalled();
  });

  it("announces within the owning tenant's context and persists lastAnnouncedVideoId", async () => {
    mockIntegrationRepo.findOne.mockResolvedValue({
      tenantId: 'tenant-1',
      channelId: 'UC123',
      apiKeyEncrypted: 'enc-key',
      lastAnnouncedVideoId: null,
    });
    mockIntegrationRepo.save.mockResolvedValue({});
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            snippet: {
              title: 'Sunday Service',
              liveBroadcastContent: 'live',
              channelId: 'UC123',
            },
          },
        ],
      }),
    } as Response);

    await service.handleNotification('vid-3', 'UC123');

    expect(mockTenantRepo.findOneBy).toHaveBeenCalledWith({ id: 'tenant-1' });
    expect(mockCls.runWith).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        schemaName: 'church_test',
      }),
      expect.any(Function),
    );
    expect(mockTxHost.tx.query).toHaveBeenCalledWith(
      expect.stringContaining('SET LOCAL search_path'),
    );
    expect(
      mockAnnouncementService.createSystemAnnouncement,
    ).toHaveBeenCalledWith(
      expect.stringContaining('Sunday Service'),
      expect.stringContaining('https://www.youtube.com/watch?v=vid-3'),
    );
    expect(mockIntegrationRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ lastAnnouncedVideoId: 'vid-3' }),
    );
  });

  it('ignores a live video that belongs to a different channel than notified', async () => {
    mockIntegrationRepo.findOne.mockResolvedValue({
      tenantId: 'tenant-1',
      channelId: 'UC123',
      apiKeyEncrypted: 'enc-key',
      lastAnnouncedVideoId: null,
    });
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            snippet: {
              title: 'Someone else entirely',
              liveBroadcastContent: 'live',
              channelId: 'UC-not-ours',
            },
          },
        ],
      }),
    } as Response);

    await service.handleNotification('vid-forged', 'UC123');

    expect(
      mockAnnouncementService.createSystemAnnouncement,
    ).not.toHaveBeenCalled();
    expect(mockIntegrationRepo.save).not.toHaveBeenCalled();
  });

  it('swallows Data API errors without throwing', async () => {
    mockIntegrationRepo.findOne.mockResolvedValue({
      tenantId: 'tenant-1',
      channelId: 'UC123',
      apiKeyEncrypted: 'enc-key',
      lastAnnouncedVideoId: null,
    });
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));

    await expect(
      service.handleNotification('vid-4', 'UC123'),
    ).resolves.toBeUndefined();
    expect(
      mockAnnouncementService.createSystemAnnouncement,
    ).not.toHaveBeenCalled();
  });

  it('skips processing when the per-video lock is already held (concurrent redelivery)', async () => {
    mockCacheService.acquireLock.mockResolvedValue(false);
    const fetchSpy = jest.spyOn(global, 'fetch');

    await service.handleNotification('vid-5', 'UC123');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(
      mockAnnouncementService.createSystemAnnouncement,
    ).not.toHaveBeenCalled();
  });

  it('releases the lock after processing', async () => {
    mockIntegrationRepo.findOne.mockResolvedValue({
      tenantId: 'tenant-1',
      channelId: 'UC123',
      lastAnnouncedVideoId: 'vid-1',
    });

    await service.handleNotification('vid-1', 'UC123');

    expect(mockCacheService.releaseLock).toHaveBeenCalledWith(
      'lock:youtube-notification:vid-1',
    );
  });
});
