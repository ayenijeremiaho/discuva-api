import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TenantInfoController } from './tenant-info.controller';
import { Tenant } from '../entity/tenant.entity';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { CloudinaryService } from '../../utility/service/cloudinary.service';

const mockTenantRepo = {
  findOneBy: jest.fn(),
  save: jest.fn(),
};

const mockCls = {
  get: jest.fn().mockReturnValue('tenant-1'),
};

const mockCloudinaryService = {
  uploadBuffer: jest.fn(),
  deleteByPublicId: jest.fn(),
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

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TenantInfoController],
      providers: [
        { provide: ClsService, useValue: mockCls },
        { provide: CloudinaryService, useValue: mockCloudinaryService },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
      ],
    })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(TenantInfoController);
  });

  describe('getInfo', () => {
    it('returns the current tenant branding fields', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue(baseTenant);
      const result = await controller.getInfo();
      expect(result).toEqual({
        name: 'Test Church',
        logoUrl: null,
        tagline: null,
        address: null,
        supportEmail: null,
        currency: 'NGN',
        timezone: 'UTC',
      });
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
      expect(result.logoUrl).toBeNull();
    });

    it('does not call Cloudinary delete when there was no logo', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue({ ...baseTenant });
      await controller.removeLogo();
      expect(mockCloudinaryService.deleteByPublicId).not.toHaveBeenCalled();
    });
  });
});
