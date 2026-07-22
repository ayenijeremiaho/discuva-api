import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

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
import { YoutubeIntegrationState } from '../entity/youtube-integration-state.entity';
import { AnnouncementService } from '../../../announcement/service/announcement.service';

const mockStateRepo = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

const mockAnnouncementService = {
  createSystemAnnouncement: jest.fn().mockResolvedValue({ id: 'ann-1' }),
};

const CONFIG = { YOUTUBE_CHANNEL_ID: 'UC123', YOUTUBE_API_KEY: 'key-123' };

describe('YoutubeLiveDetectionService', () => {
  let service: YoutubeLiveDetectionService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        YoutubeLiveDetectionService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => (CONFIG as any)[key]) },
        },
        {
          provide: getRepositoryToken(YoutubeIntegrationState),
          useValue: mockStateRepo,
        },
        { provide: AnnouncementService, useValue: mockAnnouncementService },
      ],
    }).compile();
    service = module.get(YoutubeLiveDetectionService);
  });

  it('does nothing when videoId is null', async () => {
    await service.handleNotification(null);
    expect(
      mockAnnouncementService.createSystemAnnouncement,
    ).not.toHaveBeenCalled();
  });

  it('skips already-announced video ids (idempotency)', async () => {
    mockStateRepo.findOne.mockResolvedValue({
      channelId: 'UC123',
      lastAnnouncedVideoId: 'vid-1',
    });
    const fetchSpy = jest.spyOn(global, 'fetch');

    await service.handleNotification('vid-1');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(
      mockAnnouncementService.createSystemAnnouncement,
    ).not.toHaveBeenCalled();
  });

  it('does not announce when the video is not actually live', async () => {
    mockStateRepo.findOne.mockResolvedValue(null);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            snippet: { title: 'Regular upload', liveBroadcastContent: 'none' },
          },
        ],
      }),
    } as Response);

    await service.handleNotification('vid-2');

    expect(
      mockAnnouncementService.createSystemAnnouncement,
    ).not.toHaveBeenCalled();
    expect(mockStateRepo.save).not.toHaveBeenCalled();
  });

  it('announces and persists lastAnnouncedVideoId when the video is live', async () => {
    mockStateRepo.findOne.mockResolvedValue(null);
    mockStateRepo.create.mockImplementation((v) => v);
    mockStateRepo.save.mockResolvedValue({});
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            snippet: { title: 'Sunday Service', liveBroadcastContent: 'live' },
          },
        ],
      }),
    } as Response);

    await service.handleNotification('vid-3');

    expect(
      mockAnnouncementService.createSystemAnnouncement,
    ).toHaveBeenCalledWith(
      expect.stringContaining('Sunday Service'),
      expect.stringContaining('https://www.youtube.com/watch?v=vid-3'),
    );
    expect(mockStateRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ lastAnnouncedVideoId: 'vid-3' }),
    );
  });

  it('swallows Data API errors without throwing', async () => {
    mockStateRepo.findOne.mockResolvedValue(null);
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));

    await expect(service.handleNotification('vid-4')).resolves.toBeUndefined();
    expect(
      mockAnnouncementService.createSystemAnnouncement,
    ).not.toHaveBeenCalled();
  });
});
