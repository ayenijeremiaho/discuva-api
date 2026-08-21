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
import { SocialMediaValidationService } from './social-media-validation.service';
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

const mockValidationService = {
  validate: jest.fn(),
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
    mockValidationService.validate.mockImplementation((_c, _m, targets) =>
      targets.map((t: unknown) => ({
        ...(t as object),
        errors: [],
        warnings: [],
      })),
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
          provide: SocialMediaValidationService,
          useValue: mockValidationService,
        },
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
            }),
          ]),
        }),
      );
      expect(result.id).toBe('post-1');
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
