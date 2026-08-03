import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { EmailCredentialResolverService } from './email-credential-resolver.service';
import { TenantCommunicationProviderConfig } from '../../platform-admin/entity/tenant-communication-provider-config.entity';
import { EncryptionService } from '../../utility/service/encryption.service';
import { CacheService } from '../../utility/service/cache.service';

const mockQueryBuilder = {
  innerJoin: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getOne: jest.fn(),
};

const mockConfigRepo = {
  createQueryBuilder: jest.fn(() => mockQueryBuilder),
};

const mockEncryptionService = {
  decryptFields: jest.fn((v) =>
    Object.fromEntries(
      Object.entries(v).map(([k, val]) => [k, `decrypted(${val})`]),
    ),
  ),
};

const mockCls = { get: jest.fn().mockReturnValue('tenant-1') };

// getOrSet just invokes the fetcher — the cache infra itself is trusted
// elsewhere, not what this spec is testing.
const mockCacheService = {
  getOrSet: jest.fn((_key, fetchFn) => fetchFn()),
};

describe('EmailCredentialResolverService', () => {
  let service: EmailCredentialResolverService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCls.get.mockReturnValue('tenant-1');
    mockCacheService.getOrSet.mockImplementation((_key, fetchFn) => fetchFn());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailCredentialResolverService,
        { provide: ClsService, useValue: mockCls },
        { provide: EncryptionService, useValue: mockEncryptionService },
        { provide: CacheService, useValue: mockCacheService },
        {
          provide: getRepositoryToken(TenantCommunicationProviderConfig),
          useValue: mockConfigRepo,
        },
      ],
    }).compile();
    service = module.get(EmailCredentialResolverService);
  });

  it('returns undefined when there is no tenant context', async () => {
    mockCls.get.mockReturnValue(undefined);
    expect(await service.resolveConfig()).toBeUndefined();
    expect(mockConfigRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('returns undefined when the tenant has no active email BYOK config', async () => {
    mockQueryBuilder.getOne.mockResolvedValue(null);
    expect(await service.resolveConfig()).toBeUndefined();
  });

  it('returns the decrypted credentials, providerId, and senderIdentity when configured', async () => {
    mockQueryBuilder.getOne.mockResolvedValue({
      providerId: 'resend',
      credentialsEncrypted: { apiKey: 'enc-key' },
      senderIdentity: 'church@example.com',
    });

    const result = await service.resolveConfig();

    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
      'provider.channel = :channel',
      { channel: 'email' },
    );
    expect(result).toEqual({
      providerId: 'resend',
      credentials: { apiKey: 'decrypted(enc-key)' },
      senderIdentity: 'church@example.com',
    });
  });
});
