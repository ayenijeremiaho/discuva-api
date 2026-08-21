import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SocialPostMediaService } from './social-post-media.service';
import { SocialPost } from '../entity/social-post.entity';
import { SocialPostMedia } from '../entity/social-post-media.entity';
import { SocialPostStatus } from '../enum/social-media.enum';
import { CloudinaryService } from '../../utility/service/cloudinary.service';

const mockPostRepo = { findOne: jest.fn() };
const mockMediaRepo = {
  create: jest.fn((v) => v),
  save: jest.fn(),
  findOne: jest.fn(),
  remove: jest.fn(),
};
const mockCloudinaryService = {
  uploadBuffer: jest.fn(),
  deleteByPublicId: jest.fn(),
};

function makeFile(
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File {
  return {
    buffer: Buffer.from('fake'),
    mimetype: 'image/jpeg',
    size: 1024,
    ...overrides,
  } as Express.Multer.File;
}

describe('SocialPostMediaService', () => {
  let service: SocialPostMediaService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocialPostMediaService,
        { provide: getRepositoryToken(SocialPost), useValue: mockPostRepo },
        {
          provide: getRepositoryToken(SocialPostMedia),
          useValue: mockMediaRepo,
        },
        { provide: CloudinaryService, useValue: mockCloudinaryService },
      ],
    }).compile();
    service = module.get(SocialPostMediaService);
  });

  describe('addMedia', () => {
    it('throws NotFoundException for an unknown post', async () => {
      mockPostRepo.findOne.mockResolvedValue(null);
      await expect(service.addMedia('missing', [makeFile()])).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects adding media to a non-draft post', async () => {
      mockPostRepo.findOne.mockResolvedValue({
        id: 'post-1',
        status: SocialPostStatus.PUBLISHED,
        media: [],
      });
      await expect(service.addMedia('post-1', [makeFile()])).rejects.toThrow(
        BadRequestException,
      );
    });

    it('uploads each file to Cloudinary and persists rows with incrementing order', async () => {
      mockPostRepo.findOne.mockResolvedValue({
        id: 'post-1',
        status: SocialPostStatus.DRAFT,
        media: [{ id: 'existing' }],
      });
      mockCloudinaryService.uploadBuffer.mockResolvedValue({
        secureUrl: 'https://cdn/x.jpg',
        publicId: 'social-media/x',
        resourceType: 'image',
        width: 1080,
        height: 1080,
      });
      mockMediaRepo.save.mockImplementation((rows) => Promise.resolve(rows));

      const files = [makeFile(), makeFile()];
      const result = await service.addMedia('post-1', files);

      expect(mockCloudinaryService.uploadBuffer).toHaveBeenCalledTimes(2);
      expect(result[0].order).toBe(1);
      expect(result[1].order).toBe(2);
    });
  });

  describe('removeMedia', () => {
    it('throws NotFoundException when the media does not belong to the post', async () => {
      mockMediaRepo.findOne.mockResolvedValue(null);
      await expect(service.removeMedia('post-1', 'media-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects removing media from a non-draft post', async () => {
      mockMediaRepo.findOne.mockResolvedValue({
        id: 'media-1',
        publicId: 'x',
        mimeType: 'image/jpeg',
        post: { status: SocialPostStatus.PUBLISHED },
      });
      await expect(service.removeMedia('post-1', 'media-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('removes the row and deletes the Cloudinary asset with the correct resource type', async () => {
      mockMediaRepo.findOne.mockResolvedValue({
        id: 'media-1',
        publicId: 'social-media/vid',
        mimeType: 'video/mp4',
        post: { status: SocialPostStatus.DRAFT },
      });

      await service.removeMedia('post-1', 'media-1');

      expect(mockMediaRepo.remove).toHaveBeenCalled();
      expect(mockCloudinaryService.deleteByPublicId).toHaveBeenCalledWith(
        'social-media/vid',
        'video',
      );
    });
  });
});
