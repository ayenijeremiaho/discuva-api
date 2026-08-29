import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bull';
import { ClsService } from 'nestjs-cls';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SocialPostService } from './social-post.service';
import { SocialPost } from '../entity/social-post.entity';
import { SocialPostTarget } from '../entity/social-post-target.entity';
import { SocialAccount } from '../entity/social-account.entity';
import { SocialPublisherRegistry } from '../publisher/social-publisher-registry.service';
import { SocialStatsFetcherRegistry } from '../stats/social-stats-fetcher-registry.service';
import { SocialMediaValidationService } from './social-media-validation.service';
import { SocialMediaCropService } from './social-media-crop.service';
import {
  SocialPlacement,
  SocialPlatform,
  SocialPostStatus,
  SocialPostTargetStatus,
} from '../enum/social-media.enum';

const mockPostRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  save: jest.fn(),
  create: jest.fn((v) => v),
  remove: jest.fn(),
};

const mockTargetRepo = {
  save: jest.fn(),
  create: jest.fn((v) => v),
};

const mockAccountRepo = {
  find: jest.fn(),
};

const mockPublisherRegistry = {
  resolve: jest.fn(),
};

const mockStatsFetcherRegistry = {
  resolve: jest.fn(),
};

const mockValidationService = {
  validate: jest.fn(),
};

const mockCropService = {
  needsCrop: jest.fn().mockReturnValue(false),
  resolveMediaForPlacement: jest.fn((media: unknown[]) => media),
};

const mockPublishQueue = {
  add: jest.fn(),
  getJob: jest.fn(),
};

const mockCls = {
  get: jest.fn(),
  isActive: jest.fn().mockReturnValue(true),
  getId: jest.fn().mockReturnValue('correlation-1'),
};

describe('SocialPostService', () => {
  let service: SocialPostService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default: no validation errors, so publish() tests exercise the real
    // publisher call unless a test overrides this.
    mockValidationService.validate.mockImplementation((_media, targets) =>
      targets.map((t: unknown) => ({
        ...(t as object),
        errors: [],
        warnings: [],
      })),
    );
    mockCropService.resolveMediaForPlacement.mockImplementation(
      (media: unknown[]) => media,
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocialPostService,
        { provide: getRepositoryToken(SocialPost), useValue: mockPostRepo },
        {
          provide: getRepositoryToken(SocialPostTarget),
          useValue: mockTargetRepo,
        },
        {
          provide: getRepositoryToken(SocialAccount),
          useValue: mockAccountRepo,
        },
        { provide: SocialPublisherRegistry, useValue: mockPublisherRegistry },
        {
          provide: SocialStatsFetcherRegistry,
          useValue: mockStatsFetcherRegistry,
        },
        {
          provide: SocialMediaValidationService,
          useValue: mockValidationService,
        },
        { provide: SocialMediaCropService, useValue: mockCropService },
        {
          provide: getQueueToken('social-post-publish'),
          useValue: mockPublishQueue,
        },
        { provide: ClsService, useValue: mockCls },
      ],
    }).compile();
    service = module.get(SocialPostService);
  });

  describe('create', () => {
    it('creates a draft post with one target per (account, placement)', async () => {
      mockAccountRepo.find.mockResolvedValue([
        { id: 'acc-1', platform: SocialPlatform.FACEBOOK },
        { id: 'acc-2', platform: SocialPlatform.INSTAGRAM },
      ]);
      mockPostRepo.save.mockImplementation((p) =>
        Promise.resolve({ id: 'post-1', ...p }),
      );

      const result = await service.create(
        {
          content: 'Join us Sunday!',
          targets: [
            { accountId: 'acc-1', placement: SocialPlacement.FEED },
            { accountId: 'acc-2', placement: SocialPlacement.STORY },
          ],
        },
        'admin-1',
      );

      expect(mockPostRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Join us Sunday!',
          status: SocialPostStatus.DRAFT,
          targets: expect.arrayContaining([
            expect.objectContaining({
              status: SocialPostTargetStatus.PENDING,
              placement: SocialPlacement.STORY,
              contentOverride: null,
            }),
          ]),
        }),
      );
      expect(result.id).toBe('post-1');
    });

    it('stores a per-target contentOverride when provided at creation', async () => {
      mockAccountRepo.find.mockResolvedValue([
        { id: 'acc-1', platform: SocialPlatform.X },
      ]);
      mockPostRepo.save.mockImplementation((p) =>
        Promise.resolve({ id: 'post-1', ...p }),
      );

      await service.create(
        {
          content: 'A much longer caption for the other platforms',
          targets: [
            {
              accountId: 'acc-1',
              placement: SocialPlacement.FEED,
              contentOverride: 'Shorter for X',
            },
          ],
        },
        'admin-1',
      );

      expect(mockPostRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          targets: [
            expect.objectContaining({ contentOverride: 'Shorter for X' }),
          ],
        }),
      );
    });

    it('rejects unknown target account ids', async () => {
      mockAccountRepo.find.mockResolvedValue([{ id: 'acc-1' }]);

      await expect(
        service.create(
          {
            content: 'x',
            targets: [
              { accountId: 'acc-1', placement: SocialPlacement.FEED },
              { accountId: 'missing', placement: SocialPlacement.FEED },
            ],
          },
          'admin-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('publish', () => {
    it('marks the post PUBLISHED when every target succeeds', async () => {
      mockPostRepo.findOne.mockResolvedValue({
        id: 'post-1',
        content: 'x',
        media: [],
        targets: [
          {
            id: 't1',
            account: { platform: SocialPlatform.FACEBOOK },
            placement: SocialPlacement.FEED,
          },
          {
            id: 't2',
            account: { platform: SocialPlatform.INSTAGRAM },
            placement: SocialPlacement.FEED,
          },
        ],
      });
      mockPostRepo.save.mockImplementation((p) => Promise.resolve(p));
      mockTargetRepo.save.mockResolvedValue(undefined);
      mockPublisherRegistry.resolve.mockReturnValue({
        publish: jest.fn().mockResolvedValue({ success: true }),
      });

      const result = await service.publish('post-1');

      expect(result.status).toBe(SocialPostStatus.PUBLISHED);
      expect(
        result.targets.every(
          (t: { status: string }) =>
            t.status === SocialPostTargetStatus.SUCCESS,
        ),
      ).toBe(true);
    });

    it('persists externalPostId from a successful PublishResult, for a later stats lookup', async () => {
      mockPostRepo.findOne.mockResolvedValue({
        id: 'post-1',
        content: 'x',
        media: [],
        targets: [
          {
            id: 't1',
            account: { platform: SocialPlatform.YOUTUBE },
            placement: SocialPlacement.FEED,
            externalPostId: null,
          },
        ],
      });
      mockPostRepo.save.mockImplementation((p) => Promise.resolve(p));
      mockTargetRepo.save.mockResolvedValue(undefined);
      mockPublisherRegistry.resolve.mockReturnValue({
        publish: jest
          .fn()
          .mockResolvedValue({ success: true, externalPostId: 'yt-video-1' }),
      });

      const result = await service.publish('post-1');

      expect(result.targets[0].externalPostId).toBe('yt-video-1');
    });

    it('leaves a prior externalPostId untouched when a republish attempt fails', async () => {
      mockPostRepo.findOne.mockResolvedValue({
        id: 'post-1',
        content: 'x',
        media: [],
        targets: [
          {
            id: 't1',
            account: { platform: SocialPlatform.YOUTUBE },
            placement: SocialPlacement.FEED,
            externalPostId: 'yt-video-old',
          },
        ],
      });
      mockPostRepo.save.mockImplementation((p) => Promise.resolve(p));
      mockTargetRepo.save.mockResolvedValue(undefined);
      mockPublisherRegistry.resolve.mockReturnValue({
        publish: jest
          .fn()
          .mockResolvedValue({ success: false, error: 'quota exceeded' }),
      });

      const result = await service.publish('post-1');

      expect(result.targets[0].externalPostId).toBe('yt-video-old');
    });

    it('marks the post FAILED when every target fails (e.g. nothing connected yet)', async () => {
      mockPostRepo.findOne.mockResolvedValue({
        id: 'post-1',
        content: 'x',
        media: [],
        targets: [
          {
            id: 't1',
            account: { platform: SocialPlatform.X },
            placement: SocialPlacement.FEED,
          },
        ],
      });
      mockPostRepo.save.mockImplementation((p) => Promise.resolve(p));
      mockTargetRepo.save.mockResolvedValue(undefined);
      mockPublisherRegistry.resolve.mockReturnValue({
        publish: jest.fn().mockResolvedValue({
          success: false,
          error: 'X is not connected yet',
        }),
      });

      const result = await service.publish('post-1');

      expect(result.status).toBe(SocialPostStatus.FAILED);
      expect(result.targets[0].errorMessage).toBe('X is not connected yet');
    });

    it('marks the post PARTIALLY_PUBLISHED when some targets succeed and some fail', async () => {
      mockPostRepo.findOne.mockResolvedValue({
        id: 'post-1',
        content: 'x',
        media: [],
        targets: [
          {
            id: 't1',
            account: { platform: SocialPlatform.FACEBOOK },
            placement: SocialPlacement.FEED,
          },
          {
            id: 't2',
            account: { platform: SocialPlatform.X },
            placement: SocialPlacement.FEED,
          },
        ],
      });
      mockPostRepo.save.mockImplementation((p) => Promise.resolve(p));
      mockTargetRepo.save.mockResolvedValue(undefined);
      mockPublisherRegistry.resolve
        .mockReturnValueOnce({
          publish: jest.fn().mockResolvedValue({ success: true }),
        })
        .mockReturnValueOnce({
          publish: jest
            .fn()
            .mockResolvedValue({ success: false, error: 'not connected' }),
        });

      const result = await service.publish('post-1');

      expect(result.status).toBe(SocialPostStatus.PARTIALLY_PUBLISHED);
    });

    it('fails a target with a validation error without ever calling its publisher', async () => {
      mockPostRepo.findOne.mockResolvedValue({
        id: 'post-1',
        content: 'x',
        media: [],
        targets: [
          {
            id: 't1',
            account: { platform: SocialPlatform.YOUTUBE },
            placement: SocialPlacement.FEED,
          },
        ],
      });
      mockPostRepo.save.mockImplementation((p) => Promise.resolve(p));
      mockTargetRepo.save.mockResolvedValue(undefined);
      mockValidationService.validate.mockReturnValue([
        {
          platform: SocialPlatform.YOUTUBE,
          placement: SocialPlacement.FEED,
          errors: [
            { code: 'VIDEO_REQUIRED', message: 'YouTube requires a video.' },
          ],
          warnings: [],
        },
      ]);
      const publishFn = jest.fn();
      mockPublisherRegistry.resolve.mockReturnValue({ publish: publishFn });

      const result = await service.publish('post-1');

      expect(publishFn).not.toHaveBeenCalled();
      expect(result.targets[0].status).toBe(SocialPostTargetStatus.FAILED);
      expect(result.targets[0].errorMessage).toContain(
        'YouTube requires a video.',
      );
    });

    it("validates and publishes a target's contentOverride, not the shared post content", async () => {
      mockPostRepo.findOne.mockResolvedValue({
        id: 'post-1',
        content: 'Long shared caption',
        media: [],
        targets: [
          {
            id: 't1',
            account: { platform: SocialPlatform.X },
            placement: SocialPlacement.FEED,
            contentOverride: 'Short for X',
          },
        ],
      });
      mockPostRepo.save.mockImplementation((p) => Promise.resolve(p));
      mockTargetRepo.save.mockResolvedValue(undefined);
      const publishFn = jest.fn().mockResolvedValue({ success: true });
      mockPublisherRegistry.resolve.mockReturnValue({ publish: publishFn });

      await service.publish('post-1');

      expect(mockValidationService.validate).toHaveBeenCalledWith(
        [],
        [
          expect.objectContaining({
            platform: SocialPlatform.X,
            content: 'Short for X',
          }),
        ],
      );
      expect(publishFn).toHaveBeenCalledWith(
        expect.anything(),
        'Short for X',
        [],
        SocialPlacement.FEED,
      );
    });

    it('resolves cropped media per target placement/focal point before publishing', async () => {
      const media = [
        { id: 'm1', url: 'https://res.cloudinary.com/x/image/upload/v1/a.jpg' },
      ];
      const croppedMedia = [{ ...media[0], url: 'cropped-url' }];
      mockPostRepo.findOne.mockResolvedValue({
        id: 'post-1',
        content: 'x',
        media,
        targets: [
          {
            id: 't1',
            account: { platform: SocialPlatform.INSTAGRAM },
            placement: SocialPlacement.STORY,
            mediaFocalX: 0.3,
            mediaFocalY: 0.6,
          },
        ],
      });
      mockPostRepo.save.mockImplementation((p) => Promise.resolve(p));
      mockTargetRepo.save.mockResolvedValue(undefined);
      mockCropService.resolveMediaForPlacement.mockReturnValue(croppedMedia);
      const publishFn = jest.fn().mockResolvedValue({ success: true });
      mockPublisherRegistry.resolve.mockReturnValue({ publish: publishFn });

      await service.publish('post-1');

      expect(mockCropService.resolveMediaForPlacement).toHaveBeenCalledWith(
        media,
        SocialPlacement.STORY,
        { x: 0.3, y: 0.6 },
      );
      expect(publishFn).toHaveBeenCalledWith(
        expect.anything(),
        'x',
        croppedMedia,
        SocialPlacement.STORY,
      );
    });
  });

  describe('getTargetStats', () => {
    it('resolves the platform stats fetcher and returns its result', async () => {
      const target = {
        id: 't1',
        externalPostId: 'yt-video-1',
        account: { id: 'acc-1', platform: SocialPlatform.YOUTUBE },
      };
      mockPostRepo.findOne.mockResolvedValue({
        id: 'post-1',
        targets: [target],
      });
      const getStats = jest.fn().mockResolvedValue({ viewCount: 42 });
      mockStatsFetcherRegistry.resolve.mockReturnValue({ getStats });

      const result = await service.getTargetStats('post-1', 't1');

      expect(mockStatsFetcherRegistry.resolve).toHaveBeenCalledWith(
        SocialPlatform.YOUTUBE,
      );
      expect(getStats).toHaveBeenCalledWith(target.account, 'yt-video-1');
      expect(result).toEqual({ viewCount: 42 });
    });

    it('throws BadRequestException when the target has not published yet', async () => {
      mockPostRepo.findOne.mockResolvedValue({
        id: 'post-1',
        targets: [
          {
            id: 't1',
            externalPostId: null,
            account: { platform: SocialPlatform.YOUTUBE },
          },
        ],
      });

      await expect(service.getTargetStats('post-1', 't1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockStatsFetcherRegistry.resolve).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a target that does not belong to the post', async () => {
      mockPostRepo.findOne.mockResolvedValue({ id: 'post-1', targets: [] });

      await expect(service.getTargetStats('post-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateTargetOverride', () => {
    it("sets a target's contentOverride on a draft post", async () => {
      const target = { id: 't1', contentOverride: null };
      mockPostRepo.findOne.mockResolvedValue({
        id: 'post-1',
        status: SocialPostStatus.DRAFT,
        targets: [target],
      });
      mockTargetRepo.save.mockImplementation((t) => Promise.resolve(t));

      const result = await service.updateTargetOverride('post-1', 't1', {
        contentOverride: 'Shorter caption',
      });

      expect(result.contentOverride).toBe('Shorter caption');
    });

    it('clears the override when null is sent explicitly', async () => {
      const target = { id: 't1', contentOverride: 'old value' };
      mockPostRepo.findOne.mockResolvedValue({
        id: 'post-1',
        status: SocialPostStatus.DRAFT,
        targets: [target],
      });
      mockTargetRepo.save.mockImplementation((t) => Promise.resolve(t));

      const result = await service.updateTargetOverride('post-1', 't1', {
        contentOverride: null,
      });

      expect(result.contentOverride).toBeNull();
    });

    it('rejects customizing a target once the post is no longer a draft', async () => {
      mockPostRepo.findOne.mockResolvedValue({
        id: 'post-1',
        status: SocialPostStatus.PUBLISHED,
        targets: [{ id: 't1' }],
      });

      await expect(
        service.updateTargetOverride('post-1', 't1', {
          contentOverride: 'x',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for a target that does not belong to the post', async () => {
      mockPostRepo.findOne.mockResolvedValue({
        id: 'post-1',
        status: SocialPostStatus.DRAFT,
        targets: [{ id: 't1' }],
      });

      await expect(
        service.updateTargetOverride('post-1', 'missing-target', {
          contentOverride: 'x',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateTargetFocalPoint', () => {
    it('sets both x and y on a draft target', async () => {
      const target = { id: 't1', mediaFocalX: null, mediaFocalY: null };
      mockPostRepo.findOne.mockResolvedValue({
        id: 'post-1',
        status: SocialPostStatus.DRAFT,
        targets: [target],
      });
      mockTargetRepo.save.mockImplementation((t) => Promise.resolve(t));

      const result = await service.updateTargetFocalPoint('post-1', 't1', {
        x: 0.62,
        y: 0.35,
      });

      expect(result.mediaFocalX).toBe(0.62);
      expect(result.mediaFocalY).toBe(0.35);
    });

    it('clears both when both are sent as null', async () => {
      const target = { id: 't1', mediaFocalX: 0.5, mediaFocalY: 0.5 };
      mockPostRepo.findOne.mockResolvedValue({
        id: 'post-1',
        status: SocialPostStatus.DRAFT,
        targets: [target],
      });
      mockTargetRepo.save.mockImplementation((t) => Promise.resolve(t));

      const result = await service.updateTargetFocalPoint('post-1', 't1', {
        x: null,
        y: null,
      });

      expect(result.mediaFocalX).toBeNull();
      expect(result.mediaFocalY).toBeNull();
    });

    it('rejects setting only one of x/y', async () => {
      mockPostRepo.findOne.mockResolvedValue({
        id: 'post-1',
        status: SocialPostStatus.DRAFT,
        targets: [{ id: 't1' }],
      });

      await expect(
        service.updateTargetFocalPoint('post-1', 't1', { x: 0.5, y: null }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('schedule', () => {
    it('rejects scheduling a non-draft post', async () => {
      mockPostRepo.findOne.mockResolvedValue({
        id: 'post-1',
        status: SocialPostStatus.PUBLISHED,
        targets: [],
      });
      await expect(
        service.schedule('post-1', new Date(Date.now() + 60_000)),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a scheduledFor in the past', async () => {
      mockPostRepo.findOne.mockResolvedValue({
        id: 'post-1',
        status: SocialPostStatus.DRAFT,
        targets: [],
      });
      await expect(
        service.schedule('post-1', new Date(Date.now() - 60_000)),
      ).rejects.toThrow(BadRequestException);
    });

    it('sets status SCHEDULED and queues a delayed publish job keyed by the post id', async () => {
      const post = {
        id: 'post-1',
        status: SocialPostStatus.DRAFT,
        targets: [],
      };
      mockPostRepo.findOne.mockResolvedValue(post);
      mockPostRepo.save.mockImplementation((p) => Promise.resolve(p));
      const scheduledFor = new Date(Date.now() + 60 * 60 * 1000);

      const result = await service.schedule('post-1', scheduledFor);

      expect(result.status).toBe(SocialPostStatus.SCHEDULED);
      expect(mockPublishQueue.add).toHaveBeenCalledWith(
        'publish',
        expect.objectContaining({ postId: 'post-1' }),
        expect.objectContaining({ jobId: 'post-1' }),
      );
    });
  });

  describe('cancelSchedule', () => {
    it('rejects cancelling a post that is not currently scheduled', async () => {
      mockPostRepo.findOne.mockResolvedValue({
        id: 'post-1',
        status: SocialPostStatus.DRAFT,
        targets: [],
      });
      await expect(service.cancelSchedule('post-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('removes the queued job and reverts the post to DRAFT', async () => {
      const post = {
        id: 'post-1',
        status: SocialPostStatus.SCHEDULED,
        scheduledFor: new Date(),
        targets: [],
      };
      mockPostRepo.findOne.mockResolvedValue(post);
      mockPostRepo.save.mockImplementation((p) => Promise.resolve(p));
      const remove = jest.fn();
      mockPublishQueue.getJob.mockResolvedValue({ remove });

      const result = await service.cancelSchedule('post-1');

      expect(remove).toHaveBeenCalled();
      expect(result.status).toBe(SocialPostStatus.DRAFT);
      expect(result.scheduledFor).toBeNull();
    });
  });

  describe('delete', () => {
    it('allows deleting a draft post', async () => {
      const post = { id: 'post-1', status: SocialPostStatus.DRAFT };
      mockPostRepo.findOne.mockResolvedValue(post);

      await service.delete('post-1');

      expect(mockPostRepo.remove).toHaveBeenCalledWith(post);
    });

    it('rejects deleting a published post', async () => {
      mockPostRepo.findOne.mockResolvedValue({
        id: 'post-1',
        status: SocialPostStatus.PUBLISHED,
      });

      await expect(service.delete('post-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException for an unknown post', async () => {
      mockPostRepo.findOne.mockResolvedValue(null);
      await expect(service.delete('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
