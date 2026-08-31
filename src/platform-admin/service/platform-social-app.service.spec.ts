import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PlatformSocialAppService } from './platform-social-app.service';
import { SocialPlatformApp } from '../entity/social-platform-app.entity';
import { SocialPlatform } from '../../social-media/enum/social-media.enum';
import { EncryptionService } from '../../utility/service/encryption.service';

const mockAppRepo = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  delete: jest.fn(),
};
const mockEncryptionService = {
  encrypt: jest.fn(),
  decrypt: jest.fn(),
};

describe('PlatformSocialAppService', () => {
  let service: PlatformSocialAppService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformSocialAppService,
        {
          provide: getRepositoryToken(SocialPlatformApp),
          useValue: mockAppRepo,
        },
        { provide: EncryptionService, useValue: mockEncryptionService },
      ],
    }).compile();
    service = module.get(PlatformSocialAppService);
  });

  describe('listApps', () => {
    it('lists apps ordered by platform, never exposing the secret column', async () => {
      mockAppRepo.find.mockResolvedValue([
        { platform: SocialPlatform.FACEBOOK, isActive: true },
      ]);
      const result = await service.listApps();
      expect(mockAppRepo.find).toHaveBeenCalledWith({
        order: { platform: 'ASC' },
      });
      expect(result).toEqual([
        { platform: SocialPlatform.FACEBOOK, isActive: true },
      ]);
    });
  });

  describe('listActivePlatforms', () => {
    it('returns only the platforms of active rows', async () => {
      mockAppRepo.find.mockResolvedValue([
        { platform: SocialPlatform.FACEBOOK, isActive: true },
        { platform: SocialPlatform.YOUTUBE, isActive: true },
      ]);

      const result = await service.listActivePlatforms();

      expect(mockAppRepo.find).toHaveBeenCalledWith({
        where: { isActive: true },
      });
      expect(result).toEqual([SocialPlatform.FACEBOOK, SocialPlatform.YOUTUBE]);
    });

    it('returns an empty list when nothing is registered or active', async () => {
      mockAppRepo.find.mockResolvedValue([]);
      const result = await service.listActivePlatforms();
      expect(result).toEqual([]);
    });
  });

  describe('upsertApp', () => {
    const dto = {
      platform: SocialPlatform.FACEBOOK,
      clientId: 'meta-client-id',
      clientSecret: 'meta-client-secret',
      redirectUri:
        'https://api.discuva.app/v1/integrations/social/FACEBOOK/oauth/callback',
      scopes: [
        'pages_show_list',
        'pages_read_engagement',
        'pages_manage_posts',
      ],
    };

    it('creates a new app row, encrypting the secret and joining scopes with the platform separator', async () => {
      mockAppRepo.findOneBy.mockResolvedValue(null);
      mockAppRepo.create.mockReturnValue({ platform: SocialPlatform.FACEBOOK });
      mockEncryptionService.encrypt.mockReturnValue('iv:tag:ct');
      mockAppRepo.save.mockImplementation((app) => Promise.resolve(app));

      const result = await service.upsertApp(dto);

      expect(mockEncryptionService.encrypt).toHaveBeenCalledWith(
        'meta-client-secret',
      );
      expect(mockAppRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: SocialPlatform.FACEBOOK,
          clientId: 'meta-client-id',
          clientSecretEncrypted: 'iv:tag:ct',
          redirectUri: dto.redirectUri,
          scopes: 'pages_show_list,pages_read_engagement,pages_manage_posts',
        }),
      );
      expect(result).not.toHaveProperty('clientSecretEncrypted');
    });

    it('defaults configId to null when not provided (classic Facebook Login)', async () => {
      mockAppRepo.findOneBy.mockResolvedValue(null);
      mockAppRepo.create.mockReturnValue({ platform: SocialPlatform.FACEBOOK });
      mockEncryptionService.encrypt.mockReturnValue('iv:tag:ct');
      mockAppRepo.save.mockImplementation((app) => Promise.resolve(app));

      await service.upsertApp(dto);

      expect(mockAppRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ configId: null }),
      );
    });

    it('persists configId when provided (Facebook Login for Business)', async () => {
      mockAppRepo.findOneBy.mockResolvedValue(null);
      mockAppRepo.create.mockReturnValue({ platform: SocialPlatform.FACEBOOK });
      mockEncryptionService.encrypt.mockReturnValue('iv:tag:ct');
      mockAppRepo.save.mockImplementation((app) => Promise.resolve(app));

      await service.upsertApp({ ...dto, configId: 'config-123' });

      expect(mockAppRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ configId: 'config-123' }),
      );
    });

    it('updates an existing row for the same platform rather than duplicating it', async () => {
      const existing = {
        platform: SocialPlatform.FACEBOOK,
        clientId: 'old-id',
        clientSecretEncrypted: 'old-secret',
        redirectUri: 'https://old',
        scopes: 'old-scope',
        isActive: false,
      };
      mockAppRepo.findOneBy.mockResolvedValue(existing);
      mockEncryptionService.encrypt.mockReturnValue('new-iv:new-tag:new-ct');
      mockAppRepo.save.mockImplementation((app) => Promise.resolve(app));

      await service.upsertApp(dto);

      expect(mockAppRepo.create).not.toHaveBeenCalled();
      expect(mockAppRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'meta-client-id',
          clientSecretEncrypted: 'new-iv:new-tag:new-ct',
          isActive: false,
        }),
      );
    });

    it('joins YOUTUBE scopes with a space, not a comma', async () => {
      mockAppRepo.findOneBy.mockResolvedValue(null);
      mockAppRepo.create.mockReturnValue({ platform: SocialPlatform.YOUTUBE });
      mockEncryptionService.encrypt.mockReturnValue('iv:tag:ct');
      mockAppRepo.save.mockImplementation((app) => Promise.resolve(app));

      await service.upsertApp({
        ...dto,
        platform: SocialPlatform.YOUTUBE,
        scopes: [
          'https://www.googleapis.com/auth/youtube.upload',
          'https://www.googleapis.com/auth/youtube.readonly',
        ],
      });

      expect(mockAppRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          scopes:
            'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
        }),
      );
    });

    it('rejects an unrecognized scope for a platform with a known catalog', async () => {
      await expect(
        service.upsertApp({ ...dto, scopes: ['not_a_real_permission'] }),
      ).rejects.toThrow(BadRequestException);
      expect(mockAppRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a submission missing a required scope', async () => {
      await expect(
        service.upsertApp({ ...dto, scopes: ['pages_show_list'] }),
      ).rejects.toThrow(BadRequestException);
      expect(mockAppRepo.save).not.toHaveBeenCalled();
    });

    it('accepts any non-empty scope list for a platform with no known catalog yet', async () => {
      mockAppRepo.findOneBy.mockResolvedValue(null);
      mockAppRepo.create.mockReturnValue({ platform: SocialPlatform.X });
      mockEncryptionService.encrypt.mockReturnValue('iv:tag:ct');
      mockAppRepo.save.mockImplementation((app) => Promise.resolve(app));

      await service.upsertApp({
        ...dto,
        platform: SocialPlatform.X,
        scopes: ['whatever_x_calls_it'],
      });

      expect(mockAppRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ scopes: 'whatever_x_calls_it' }),
      );
    });
  });

  describe('setActive', () => {
    it('throws when the platform has no registered app', async () => {
      mockAppRepo.findOneBy.mockResolvedValue(null);
      await expect(service.setActive(SocialPlatform.X, false)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('flips isActive and strips the secret from the response', async () => {
      mockAppRepo.findOneBy.mockResolvedValue({
        platform: SocialPlatform.YOUTUBE,
        clientSecretEncrypted: 'iv:tag:ct',
        isActive: true,
      });
      mockAppRepo.save.mockImplementation((app) => Promise.resolve(app));

      const result = await service.setActive(SocialPlatform.YOUTUBE, false);

      expect(mockAppRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
      );
      expect(result).not.toHaveProperty('clientSecretEncrypted');
    });
  });

  describe('deleteApp', () => {
    it('throws when the platform has no registered app', async () => {
      mockAppRepo.delete.mockResolvedValue({ affected: 0 });
      await expect(service.deleteApp(SocialPlatform.X)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deletes the row for a registered platform', async () => {
      mockAppRepo.delete.mockResolvedValue({ affected: 1 });
      await service.deleteApp(SocialPlatform.FACEBOOK);
      expect(mockAppRepo.delete).toHaveBeenCalledWith({
        platform: SocialPlatform.FACEBOOK,
      });
    });
  });

  describe('getDecryptedApp', () => {
    it('returns null when the platform has no registered app', async () => {
      mockAppRepo.findOne.mockResolvedValue(null);
      const result = await service.getDecryptedApp(SocialPlatform.INSTAGRAM);
      expect(result).toBeNull();
    });

    it('decrypts and returns the client secret for internal OAuth use', async () => {
      mockAppRepo.findOne.mockResolvedValue({
        platform: SocialPlatform.FACEBOOK,
        clientId: 'meta-client-id',
        clientSecretEncrypted: 'iv:tag:ct',
        redirectUri: 'https://api.discuva.app/callback',
        scopes: 'pages_manage_posts',
        isActive: true,
      });
      mockEncryptionService.decrypt.mockReturnValue('plaintext-secret');

      const result = await service.getDecryptedApp(SocialPlatform.FACEBOOK);

      expect(mockEncryptionService.decrypt).toHaveBeenCalledWith('iv:tag:ct');
      expect(result?.clientSecret).toBe('plaintext-secret');
      expect(result?.app.clientId).toBe('meta-client-id');
    });

    // Regression test: configId was added to the entity but initially
    // missed from this method's explicit `select` array — since select:false
    // columns and any column not in an explicit select list are silently
    // omitted by TypeORM, app.configId came back undefined here even when
    // set, which meant MetaGraphApiService.buildAuthorizeUrl() could never
    // actually see it and always fell back to the classic scope param.
    it('includes configId in the explicit select list, so a Business Login app is actually usable', async () => {
      mockAppRepo.findOne.mockResolvedValue({
        platform: SocialPlatform.FACEBOOK,
        clientId: 'meta-client-id',
        clientSecretEncrypted: 'iv:tag:ct',
        redirectUri: 'https://api.discuva.app/callback',
        scopes: 'pages_manage_posts',
        configId: 'config-123',
        isActive: true,
      });
      mockEncryptionService.decrypt.mockReturnValue('plaintext-secret');

      const result = await service.getDecryptedApp(SocialPlatform.FACEBOOK);

      expect(mockAppRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.arrayContaining(['configId']),
        }),
      );
      expect(result?.app.configId).toBe('config-123');
    });
  });
});
