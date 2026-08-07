import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { TenantAssetService } from './tenant-asset.service';
import { TenantAssetOverride } from '../entity/tenant-asset-override.entity';
import { CloudinaryService } from '../../utility/service/cloudinary.service';

const mockOverrideRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn((v) => v),
  save: jest.fn((v) => Promise.resolve({ id: 'override-1', ...v })),
  remove: jest.fn(),
};

const mockCloudinaryService = {
  uploadBuffer: jest.fn(),
  deleteByPublicId: jest.fn(),
};

describe('TenantAssetService', () => {
  let service: TenantAssetService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantAssetService,
        {
          provide: getRepositoryToken(TenantAssetOverride),
          useValue: mockOverrideRepo,
        },
        { provide: CloudinaryService, useValue: mockCloudinaryService },
      ],
    }).compile();
    service = module.get(TenantAssetService);
  });

  describe('getCatalog', () => {
    it('returns the known asset list', () => {
      const catalog = service.getCatalog();
      expect(catalog.length).toBeGreaterThan(0);
      expect(catalog.some((a) => a.key === 'login-backdrop')).toBe(true);
    });
  });

  describe('getOverrides', () => {
    it('maps rows to a flat { assetKey: imageUrl } object', async () => {
      mockOverrideRepo.find.mockResolvedValue([
        {
          assetKey: 'login-backdrop',
          imageUrl: 'https://cdn.example.com/login.jpg',
        },
        {
          assetKey: 'home-door-welcome',
          imageUrl: 'https://cdn.example.com/home.jpg',
        },
      ]);

      const result = await service.getOverrides('tenant-1');

      expect(result).toEqual({
        'login-backdrop': 'https://cdn.example.com/login.jpg',
        'home-door-welcome': 'https://cdn.example.com/home.jpg',
      });
    });

    it('returns an empty object when nothing is overridden', async () => {
      mockOverrideRepo.find.mockResolvedValue([]);
      expect(await service.getOverrides('tenant-1')).toEqual({});
    });
  });

  describe('setOverride', () => {
    const file = {
      buffer: Buffer.from('x'),
      mimetype: 'image/png',
    } as Express.Multer.File;

    it('rejects an unknown asset key', async () => {
      await expect(
        service.setOverride('tenant-1', 'not-a-real-key', file),
      ).rejects.toThrow(BadRequestException);
      expect(mockCloudinaryService.uploadBuffer).not.toHaveBeenCalled();
    });

    it('creates a new override and does not delete anything when none existed', async () => {
      mockOverrideRepo.findOne.mockResolvedValue(null);
      mockCloudinaryService.uploadBuffer.mockResolvedValue({
        secureUrl: 'https://cdn.example.com/new.jpg',
        publicId: 'tenant-assets/1',
        resourceType: 'image',
      });
      mockOverrideRepo.find.mockResolvedValue([
        {
          assetKey: 'login-backdrop',
          imageUrl: 'https://cdn.example.com/new.jpg',
        },
      ]);

      const result = await service.setOverride(
        'tenant-1',
        'login-backdrop',
        file,
      );

      expect(mockOverrideRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          assetKey: 'login-backdrop',
          imageUrl: 'https://cdn.example.com/new.jpg',
          imagePublicId: 'tenant-assets/1',
        }),
      );
      expect(mockCloudinaryService.deleteByPublicId).not.toHaveBeenCalled();
      expect(result).toEqual({
        'login-backdrop': 'https://cdn.example.com/new.jpg',
      });
    });

    it('replaces an existing override and deletes the previous Cloudinary asset', async () => {
      mockOverrideRepo.findOne.mockResolvedValue({
        id: 'override-1',
        assetKey: 'login-backdrop',
        imageUrl: 'https://cdn.example.com/old.jpg',
        imagePublicId: 'tenant-assets/old',
      });
      mockCloudinaryService.uploadBuffer.mockResolvedValue({
        secureUrl: 'https://cdn.example.com/new.jpg',
        publicId: 'tenant-assets/new',
        resourceType: 'image',
      });
      mockOverrideRepo.find.mockResolvedValue([]);

      await service.setOverride('tenant-1', 'login-backdrop', file);

      expect(mockCloudinaryService.deleteByPublicId).toHaveBeenCalledWith(
        'tenant-assets/old',
        'image',
      );
    });
  });

  describe('removeOverride', () => {
    it('rejects an unknown asset key', async () => {
      await expect(
        service.removeOverride('tenant-1', 'not-a-real-key'),
      ).rejects.toThrow(BadRequestException);
    });

    it('does nothing (no Cloudinary call) when no override exists', async () => {
      mockOverrideRepo.findOne.mockResolvedValue(null);
      mockOverrideRepo.find.mockResolvedValue([]);

      await service.removeOverride('tenant-1', 'login-backdrop');

      expect(mockOverrideRepo.remove).not.toHaveBeenCalled();
      expect(mockCloudinaryService.deleteByPublicId).not.toHaveBeenCalled();
    });

    it('removes the row and deletes the Cloudinary asset when an override exists', async () => {
      mockOverrideRepo.findOne.mockResolvedValue({
        id: 'override-1',
        assetKey: 'login-backdrop',
        imagePublicId: 'tenant-assets/old',
      });
      mockOverrideRepo.find.mockResolvedValue([]);

      await service.removeOverride('tenant-1', 'login-backdrop');

      expect(mockOverrideRepo.remove).toHaveBeenCalled();
      expect(mockCloudinaryService.deleteByPublicId).toHaveBeenCalledWith(
        'tenant-assets/old',
        'image',
      );
    });
  });
});
