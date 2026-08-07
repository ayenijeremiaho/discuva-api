import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SocialPostService } from './social-post.service';
import { SocialPost } from '../entity/social-post.entity';
import { SocialPostTarget } from '../entity/social-post-target.entity';
import { SocialAccount } from '../entity/social-account.entity';
import { SocialPublisherRegistry } from '../publisher/social-publisher-registry.service';
import {
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

describe('SocialPostService', () => {
  let service: SocialPostService;

  beforeEach(async () => {
    jest.clearAllMocks();
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
      ],
    }).compile();
    service = module.get(SocialPostService);
  });

  describe('create', () => {
    it('creates a draft post with one target per account', async () => {
      mockAccountRepo.find.mockResolvedValue([
        { id: 'acc-1', platform: SocialPlatform.FACEBOOK },
        { id: 'acc-2', platform: SocialPlatform.INSTAGRAM },
      ]);
      mockPostRepo.save.mockImplementation((p) =>
        Promise.resolve({ id: 'post-1', ...p }),
      );

      const result = await service.create(
        { content: 'Join us Sunday!', targetAccountIds: ['acc-1', 'acc-2'] },
        'admin-1',
      );

      expect(mockPostRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Join us Sunday!',
          status: SocialPostStatus.DRAFT,
          targets: expect.arrayContaining([
            expect.objectContaining({ status: SocialPostTargetStatus.PENDING }),
          ]),
        }),
      );
      expect(result.id).toBe('post-1');
    });

    it('rejects unknown target account ids', async () => {
      mockAccountRepo.find.mockResolvedValue([{ id: 'acc-1' }]);

      await expect(
        service.create(
          { content: 'x', targetAccountIds: ['acc-1', 'missing'] },
          'admin-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('publish', () => {
    it('marks the post PUBLISHED when every target succeeds', async () => {
      mockPostRepo.findOne.mockResolvedValue({
        id: 'post-1',
        targets: [
          { id: 't1', account: { platform: SocialPlatform.FACEBOOK } },
          { id: 't2', account: { platform: SocialPlatform.INSTAGRAM } },
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
        targets: [{ id: 't1', account: { platform: SocialPlatform.X } }],
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
        targets: [
          { id: 't1', account: { platform: SocialPlatform.FACEBOOK } },
          { id: 't2', account: { platform: SocialPlatform.X } },
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
