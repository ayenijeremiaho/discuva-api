import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { SocialMediaRetentionScheduler } from './social-media-retention.scheduler';
import { SocialPost } from '../entity/social-post.entity';
import { SocialPostMedia } from '../entity/social-post-media.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { SocialPostStatus } from '../enum/social-media.enum';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';
import { CloudinaryService } from '../../utility/service/cloudinary.service';

jest.mock('../../tenant/utility/run-in-tenant-context', () => ({
  runInTenantContext: jest.fn((cls, txHost, envelope, fn) => fn()),
}));

const mockPostRepo = { find: jest.fn() };
const mockMediaRepo = { remove: jest.fn() };
const mockTenantRepo = { find: jest.fn() };
const mockPlatformSettingsService = {
  getSocialMediaDraftRetentionDays: jest.fn().mockResolvedValue(30),
};
const mockCloudinaryService = { deleteByPublicId: jest.fn() };
const mockCls = {};
const mockTxHost = {};

describe('SocialMediaRetentionScheduler', () => {
  let scheduler: SocialMediaRetentionScheduler;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPlatformSettingsService.getSocialMediaDraftRetentionDays.mockResolvedValue(
      30,
    );
    mockTenantRepo.find.mockResolvedValue([
      { id: 't1', schemaName: 's1', isActive: true },
    ]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocialMediaRetentionScheduler,
        { provide: getRepositoryToken(SocialPost), useValue: mockPostRepo },
        {
          provide: getRepositoryToken(SocialPostMedia),
          useValue: mockMediaRepo,
        },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        {
          provide: PlatformSettingsService,
          useValue: mockPlatformSettingsService,
        },
        { provide: CloudinaryService, useValue: mockCloudinaryService },
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
      ],
    }).compile();
    scheduler = module.get(SocialMediaRetentionScheduler);
  });

  it('skips posts with no attached media', async () => {
    mockPostRepo.find.mockResolvedValue([
      { id: 'post-1', status: SocialPostStatus.DRAFT, media: [] },
    ]);

    await scheduler.deleteStaleDraftMedia();

    expect(mockMediaRepo.remove).not.toHaveBeenCalled();
    expect(mockCloudinaryService.deleteByPublicId).not.toHaveBeenCalled();
  });

  it('deletes the Cloudinary asset and DB row for every media item on a stale draft', async () => {
    const mediaItems = [
      { id: 'm1', publicId: 'social-media/img', mimeType: 'image/jpeg' },
      { id: 'm2', publicId: 'social-media/vid', mimeType: 'video/mp4' },
    ];
    mockPostRepo.find.mockResolvedValue([
      { id: 'post-1', status: SocialPostStatus.DRAFT, media: mediaItems },
    ]);

    await scheduler.deleteStaleDraftMedia();

    expect(mockCloudinaryService.deleteByPublicId).toHaveBeenCalledWith(
      'social-media/img',
      'image',
    );
    expect(mockCloudinaryService.deleteByPublicId).toHaveBeenCalledWith(
      'social-media/vid',
      'video',
    );
    expect(mockMediaRepo.remove).toHaveBeenCalledWith(mediaItems);
  });

  it('reads the configured retention window rather than a hardcoded value', async () => {
    mockPlatformSettingsService.getSocialMediaDraftRetentionDays.mockResolvedValue(
      7,
    );
    mockPostRepo.find.mockResolvedValue([]);

    await scheduler.deleteStaleDraftMedia();

    expect(
      mockPlatformSettingsService.getSocialMediaDraftRetentionDays,
    ).toHaveBeenCalled();
  });
});
