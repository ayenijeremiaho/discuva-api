import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { SmsCredentialResolverService } from './sms-credential-resolver.service';
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

describe('SmsCredentialResolverService', () => {
  let service: SmsCredentialResolverService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCls.get.mockReturnValue('tenant-1');
    mockCacheService.getOrSet.mockImplementation((_key, fetchFn) => fetchFn());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmsCredentialResolverService,
        { provide: ClsService, useValue: mockCls },
        { provide: EncryptionService, useValue: mockEncryptionService },
        { provide: CacheService, useValue: mockCacheService },
        {
          provide: getRepositoryToken(TenantCommunicationProviderConfig),
          useValue: mockConfigRepo,
        },
      ],
    }).compile();
    service = module.get(SmsCredentialResolverService);
  });

  it('returns undefined when there is no tenant context', async () => {
    mockCls.get.mockReturnValue(undefined);
    expect(await service.resolveConfig()).toBeUndefined();
    expect(mockConfigRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('returns undefined when the tenant has no active sms BYOK config', async () => {
    mockQueryBuilder.getOne.mockResolvedValue(null);
    expect(await service.resolveConfig()).toBeUndefined();
  });

  it('returns the decrypted credentials and providerId when configured', async () => {
    mockQueryBuilder.getOne.mockResolvedValue({
      providerId: 'termii',
      credentialsEncrypted: { apiKey: 'enc-key' },
    });

    const result = await service.resolveConfig();

    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
      'provider.channel = :channel',
      { channel: 'sms' },
    );
    expect(result).toEqual({
      providerId: 'termii',
      credentials: { apiKey: 'decrypted(enc-key)' },
    });
  });

  it('also filters on the platform catalog entry being active, not just the tenant config', async () => {
    mockQueryBuilder.getOne.mockResolvedValue(null);
    await service.resolveConfig();
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
      'provider.isActive = true',
    );
  });
});
