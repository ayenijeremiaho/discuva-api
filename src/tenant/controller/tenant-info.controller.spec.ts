import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TenantInfoController } from './tenant-info.controller';
import { Tenant } from '../entity/tenant.entity';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { CloudinaryService } from '../../utility/service/cloudinary.service';
import { CacheService } from '../../utility/service/cache.service';
import { TenantAssetService } from '../service/tenant-asset.service';

const mockTenantRepo = {
  findOneBy: jest.fn(),
  save: jest.fn(),
};

const mockCacheService = {
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(1),
  key: jest.fn().mockReturnValue('cache-key'),
};

const mockCls = {
  get: jest.fn().mockReturnValue('tenant-1'),
};

const mockCloudinaryService = {
  uploadBuffer: jest.fn(),
  deleteByPublicId: jest.fn(),
};

const mockTenantAssetService = {
  getCatalog: jest.fn(),
  getOverrides: jest.fn().mockResolvedValue({}),
  setOverride: jest.fn(),
  removeOverride: jest.fn(),
};

const mockConfigService = {
  get: jest
    .fn()
    .mockReturnValue('https://cdn.example.com/platform-default-logo.png'),
};

const baseTenant = {
  id: 'tenant-1',
  name: 'Test Church',
  logoUrl: null,
  logoPublicId: null,
  tagline: null,
  address: null,
  supportEmail: null,
  currency: 'NGN',
  timezone: 'UTC',
};

describe('TenantInfoController', () => {
  let controller: TenantInfoController;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCls.get.mockReturnValue('tenant-1');
    mockTenantRepo.save.mockImplementation((t) => Promise.resolve(t));
    mockTenantAssetService.getOverrides.mockResolvedValue({});
    mockConfigService.get.mockReturnValue(
      'https://cdn.example.com/platform-default-logo.png',
    );

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TenantInfoController],
      providers: [
        { provide: ClsService, useValue: mockCls },
        { provide: CloudinaryService, useValue: mockCloudinaryService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: TenantAssetService, useValue: mockTenantAssetService },
      ],
    })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(TenantInfoController);
  });

  describe('getInfo', () => {
    it('falls back to the LOGO_URL env default when the tenant has no logo of its own', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue(baseTenant);
      mockTenantAssetService.getOverrides.mockResolvedValue({
        'login-backdrop': 'https://cdn.example.com/login.jpg',
      });

      const result = await controller.getInfo();

      expect(result).toEqual({
        name: 'Test Church',
        logoUrl: 'https://cdn.example.com/platform-default-logo.png',
        tagline: null,
        address: null,
        supportEmail: null,
        currency: 'NGN',
        timezone: 'UTC',
        assets: { 'login-backdrop': 'https://cdn.example.com/login.jpg' },
      });
      expect(mockTenantAssetService.getOverrides).toHaveBeenCalledWith(
        'tenant-1',
      );
    });

    it("prefers the tenant's own uploaded logo over the LOGO_URL default", async () => {
      mockTenantRepo.findOneBy.mockResolvedValue({
        ...baseTenant,
        logoUrl: 'https://cdn.example.com/own-logo.png',
      });

      const result = await controller.getInfo();

      expect(result.logoUrl).toBe('https://cdn.example.com/own-logo.png');
    });

    it('throws NotFoundException when there is no tenant in CLS', async () => {
      mockCls.get.mockReturnValue(undefined);
      await expect(controller.getInfo()).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateInfo', () => {
    it('applies only the provided fields and persists them', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue({ ...baseTenant });

      const result = await controller.updateInfo({
        tagline: 'New tagline',
        supportEmail: 'help@example.com',
      });

      expect(mockTenantRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Church',
          tagline: 'New tagline',
          supportEmail: 'help@example.com',
        }),
      );
      expect(result.tagline).toBe('New tagline');
      expect(result.supportEmail).toBe('help@example.com');
      expect(result.name).toBe('Test Church');
      expect(mockCacheService.del).toHaveBeenCalledWith(
        'tenant-branding:tenant-1',
      );
    });

    it('throws NotFoundException when there is no tenant in CLS', async () => {
      mockCls.get.mockReturnValue(undefined);
      await expect(controller.updateInfo({ tagline: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('uploadLogo', () => {
    const file = {
      buffer: Buffer.from('fake-image'),
      mimetype: 'image/png',
    } as Express.Multer.File;

    it('throws BadRequestException when no file is provided', async () => {
      await expect(controller.uploadLogo(undefined)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('uploads, saves the new logo, and deletes no previous asset when none existed', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue({ ...baseTenant });
      mockCloudinaryService.uploadBuffer.mockResolvedValue({
        secureUrl: 'https://cdn.example.com/logo.png',
        publicId: 'church-logos/1',
        resourceType: 'image',
      });

      const result = await controller.uploadLogo(file);

      expect(mockCloudinaryService.uploadBuffer).toHaveBeenCalledWith(
        file.buffer,
        'church-logos',
        undefined,
        'image/png',
      );
      expect(mockTenantRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          logoUrl: 'https://cdn.example.com/logo.png',
          logoPublicId: 'church-logos/1',
        }),
      );
      expect(mockCloudinaryService.deleteByPublicId).not.toHaveBeenCalled();
      expect(result.logoUrl).toBe('https://cdn.example.com/logo.png');
      expect(mockCacheService.del).toHaveBeenCalledWith(
        'tenant-branding:tenant-1',
      );
    });

    it('deletes the previous asset after replacing an existing logo', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue({
        ...baseTenant,
        logoUrl: 'https://cdn.example.com/old.png',
        logoPublicId: 'church-logos/old',
      });
      mockCloudinaryService.uploadBuffer.mockResolvedValue({
        secureUrl: 'https://cdn.example.com/new.png',
        publicId: 'church-logos/new',
        resourceType: 'image',
      });

      await controller.uploadLogo(file);

      expect(mockCloudinaryService.deleteByPublicId).toHaveBeenCalledWith(
        'church-logos/old',
        'image',
      );
    });
  });

  describe('removeLogo', () => {
    it('clears the logo fields and deletes the Cloudinary asset', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue({
        ...baseTenant,
        logoUrl: 'https://cdn.example.com/old.png',
        logoPublicId: 'church-logos/old',
      });

      const result = await controller.removeLogo();

      expect(mockTenantRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ logoUrl: null, logoPublicId: null }),
      );
      expect(mockCloudinaryService.deleteByPublicId).toHaveBeenCalledWith(
        'church-logos/old',
        'image',
      );
      // The response falls back to LOGO_URL once the tenant's own logo is
      // cleared — null is the DB column value, not what callers see.
      expect(result.logoUrl).toBe(
        'https://cdn.example.com/platform-default-logo.png',
      );
      expect(mockCacheService.del).toHaveBeenCalledWith(
        'tenant-branding:tenant-1',
      );
    });

    it('does not call Cloudinary delete when there was no logo', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue({ ...baseTenant });
      await controller.removeLogo();
      expect(mockCloudinaryService.deleteByPublicId).not.toHaveBeenCalled();
    });
  });

  describe('getAssetCatalog', () => {
    it('delegates to TenantAssetService', () => {
      mockTenantAssetService.getCatalog.mockReturnValue([
        { key: 'login-backdrop' },
      ]);
      expect(controller.getAssetCatalog()).toEqual([{ key: 'login-backdrop' }]);
    });
  });

  describe('setAsset', () => {
    const file = {
      buffer: Buffer.from('fake-image'),
      mimetype: 'image/png',
    } as Express.Multer.File;

    it('throws BadRequestException when no file is provided', async () => {
      await expect(
        controller.setAsset('login-backdrop', undefined),
      ).rejects.toThrow(BadRequestException);
    });

    it('resolves the current tenant and delegates to TenantAssetService', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue({ ...baseTenant });
      mockTenantAssetService.setOverride.mockResolvedValue({
        'login-backdrop': 'https://cdn.example.com/new-login.jpg',
      });

      const result = await controller.setAsset('login-backdrop', file);

      expect(mockTenantAssetService.setOverride).toHaveBeenCalledWith(
        'tenant-1',
        'login-backdrop',
        file,
      );
      expect(result).toEqual({
        assets: { 'login-backdrop': 'https://cdn.example.com/new-login.jpg' },
      });
    });
  });

  describe('removeAsset', () => {
    it('resolves the current tenant and delegates to TenantAssetService', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue({ ...baseTenant });
      mockTenantAssetService.removeOverride.mockResolvedValue({});

      const result = await controller.removeAsset('login-backdrop');

      expect(mockTenantAssetService.removeOverride).toHaveBeenCalledWith(
        'tenant-1',
        'login-backdrop',
      );
      expect(result).toEqual({ assets: {} });
    });
  });
});
