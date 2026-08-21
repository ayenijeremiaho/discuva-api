import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
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

  describe('upsertApp', () => {
    const dto = {
      platform: SocialPlatform.FACEBOOK,
      clientId: 'meta-client-id',
      clientSecret: 'meta-client-secret',
      redirectUri:
        'https://api.discuva.app/v1/integrations/social/FACEBOOK/oauth/callback',
      scopes: 'pages_manage_posts,pages_read_engagement',
    };

    it('creates a new app row, encrypting the secret, and strips it from the response', async () => {
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
          scopes: dto.scopes,
        }),
      );
      expect(result).not.toHaveProperty('clientSecretEncrypted');
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
  });
});
