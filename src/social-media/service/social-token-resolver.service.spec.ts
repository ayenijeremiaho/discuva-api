import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { SocialTokenResolverService } from './social-token-resolver.service';
import { SocialAccount } from '../entity/social-account.entity';
import { SocialPlatform } from '../enum/social-media.enum';
import { EncryptionService } from '../../utility/service/encryption.service';
import { SocialTokenRefresherRegistry } from '../token/social-token-refresher-registry.service';

const mockAccountRepo = {
  findOne: jest.fn(),
  save: jest.fn(),
};
const mockEncryptionService = {
  encrypt: jest.fn(),
  decrypt: jest.fn(),
};
const mockRefresher = { refresh: jest.fn() };
const mockRefresherRegistry = { resolve: jest.fn(() => mockRefresher) };

describe('SocialTokenResolverService', () => {
  let service: SocialTokenResolverService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRefresherRegistry.resolve.mockReturnValue(mockRefresher);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocialTokenResolverService,
        {
          provide: getRepositoryToken(SocialAccount),
          useValue: mockAccountRepo,
        },
        { provide: EncryptionService, useValue: mockEncryptionService },
        {
          provide: SocialTokenRefresherRegistry,
          useValue: mockRefresherRegistry,
        },
      ],
    }).compile();
    service = module.get(SocialTokenResolverService);
  });

  it('throws NotFoundException when the account does not exist', async () => {
    mockAccountRepo.findOne.mockResolvedValue(null);
    await expect(service.getValidAccessToken('missing-id')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws when the account has never been connected', async () => {
    mockAccountRepo.findOne.mockResolvedValue({
      platform: SocialPlatform.FACEBOOK,
      accessTokenEncrypted: null,
    });
    await expect(service.getValidAccessToken('acc-1')).rejects.toThrow(
      /not connected/i,
    );
  });

  it('decrypts and returns the token directly when not expired', async () => {
    mockAccountRepo.findOne.mockResolvedValue({
      platform: SocialPlatform.FACEBOOK,
      accessTokenEncrypted: 'iv:tag:ct',
      refreshTokenEncrypted: null,
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    mockEncryptionService.decrypt.mockReturnValue('plaintext-token');

    const result = await service.getValidAccessToken('acc-1');

    expect(mockEncryptionService.decrypt).toHaveBeenCalledWith('iv:tag:ct');
    expect(result).toBe('plaintext-token');
    expect(mockRefresherRegistry.resolve).not.toHaveBeenCalled();
  });

  it('returns the token directly when tokenExpiresAt is null (no expiry tracked)', async () => {
    mockAccountRepo.findOne.mockResolvedValue({
      platform: SocialPlatform.FACEBOOK,
      accessTokenEncrypted: 'iv:tag:ct',
      refreshTokenEncrypted: null,
      tokenExpiresAt: null,
    });
    mockEncryptionService.decrypt.mockReturnValue('plaintext-token');

    const result = await service.getValidAccessToken('acc-1');

    expect(result).toBe('plaintext-token');
  });

  it('throws when expired and no refresh token is available', async () => {
    mockAccountRepo.findOne.mockResolvedValue({
      platform: SocialPlatform.INSTAGRAM,
      accessTokenEncrypted: 'iv:tag:ct',
      refreshTokenEncrypted: null,
      tokenExpiresAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    await expect(service.getValidAccessToken('acc-1')).rejects.toThrow(
      /reconnect the account/i,
    );
  });

  it('refreshes, encrypts, and persists a new token when expired and a refresh token exists', async () => {
    const account = {
      platform: SocialPlatform.YOUTUBE,
      accessTokenEncrypted: 'old-iv:old-tag:old-ct',
      refreshTokenEncrypted: 'refresh-iv:refresh-tag:refresh-ct',
      tokenExpiresAt: new Date(Date.now() - 60 * 60 * 1000),
    };
    mockAccountRepo.findOne.mockResolvedValue(account);
    mockEncryptionService.decrypt.mockReturnValue('plaintext-refresh-token');
    mockRefresher.refresh.mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresInSeconds: 3600,
    });
    mockEncryptionService.encrypt
      .mockReturnValueOnce('new-access-encrypted')
      .mockReturnValueOnce('new-refresh-encrypted');
    mockAccountRepo.save.mockImplementation((a) => Promise.resolve(a));

    const result = await service.getValidAccessToken('acc-1');

    expect(mockRefresher.refresh).toHaveBeenCalledWith(
      'plaintext-refresh-token',
    );
    expect(mockAccountRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        accessTokenEncrypted: 'new-access-encrypted',
        refreshTokenEncrypted: 'new-refresh-encrypted',
      }),
    );
    expect(result).toBe('new-access-token');
  });

  it('keeps the existing refresh token when the platform does not rotate it', async () => {
    const account = {
      platform: SocialPlatform.YOUTUBE,
      accessTokenEncrypted: 'old-iv:old-tag:old-ct',
      refreshTokenEncrypted: 'refresh-iv:refresh-tag:refresh-ct',
      tokenExpiresAt: new Date(Date.now() - 60 * 60 * 1000),
    };
    mockAccountRepo.findOne.mockResolvedValue(account);
    mockEncryptionService.decrypt.mockReturnValue('plaintext-refresh-token');
    mockRefresher.refresh.mockResolvedValue({
      accessToken: 'new-access-token',
      expiresInSeconds: 3600,
    });
    mockEncryptionService.encrypt.mockReturnValue('new-access-encrypted');
    mockAccountRepo.save.mockImplementation((a) => Promise.resolve(a));

    await service.getValidAccessToken('acc-1');

    expect(mockAccountRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        refreshTokenEncrypted: 'refresh-iv:refresh-tag:refresh-ct',
      }),
    );
  });
});
