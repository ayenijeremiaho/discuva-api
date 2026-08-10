import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { TenantGivingProviderService } from './tenant-giving-provider.service';
import { GivingProvider } from '../entity/giving-provider.entity';
import { TenantGivingProviderConfig } from '../entity/tenant-giving-provider-config.entity';
import { EncryptionService } from '../../utility/service/encryption.service';
import { CacheService } from '../../utility/service/cache.service';

const mockCls = { get: jest.fn().mockReturnValue('tenant-1') };
const mockEncryptionService = {
  encryptFields: jest.fn((v) => v),
  decryptFields: jest.fn((v) => v),
};
const mockCacheService = { del: jest.fn() };
const mockProviderRepo = { findOneBy: jest.fn(), find: jest.fn() };
const mockConfigRepo = {
  findOneBy: jest.fn(),
  create: jest.fn((v) => v),
  find: jest.fn(),
};

const mockQueryBuilder = {
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  execute: jest.fn().mockResolvedValue(undefined),
};
const mockManager = {
  save: jest.fn(),
  createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
};
const mockDataSource = {
  transaction: jest.fn((cb) => cb(mockManager)),
};

describe('TenantGivingProviderService', () => {
  let service: TenantGivingProviderService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCls.get.mockReturnValue('tenant-1');
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantGivingProviderService,
        { provide: ClsService, useValue: mockCls },
        { provide: EncryptionService, useValue: mockEncryptionService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        {
          provide: getRepositoryToken(GivingProvider),
          useValue: mockProviderRepo,
        },
        {
          provide: getRepositoryToken(TenantGivingProviderConfig),
          useValue: mockConfigRepo,
        },
      ],
    }).compile();
    service = module.get(TenantGivingProviderService);
  });

  describe('upsertConfig', () => {
    it('throws NotFoundException for an unregistered providerId', async () => {
      mockProviderRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.upsertConfig('unknown', { credentials: { secretKey: 'x' } }),
      ).rejects.toThrow(NotFoundException);
    });

    it('saves the config and deactivates every other provider for this tenant', async () => {
      mockProviderRepo.findOneBy.mockResolvedValue({
        id: 'stripe',
        name: 'Stripe',
      });
      mockConfigRepo.findOneBy.mockResolvedValue(null);

      const result = await service.upsertConfig('stripe', {
        credentials: { secretKey: 'sk_1', webhookSecret: 'whsec_1' },
      });

      expect(mockManager.save).toHaveBeenCalled();
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'tenantId = :tenantId',
        {
          tenantId: 'tenant-1',
        },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'providerId != :keepProviderId',
        { keepProviderId: 'stripe' },
      );
      expect(mockCacheService.del).toHaveBeenCalledWith(
        'giving-provider-config:tenant-1',
      );
      expect(result).toEqual({
        providerId: 'stripe',
        providerName: 'Stripe',
        isActive: true,
      });
    });
  });

  describe('setActive', () => {
    it('throws NotFoundException when no config exists yet', async () => {
      mockProviderRepo.findOneBy.mockResolvedValue({
        id: 'kora',
        name: 'Korapay',
      });
      mockConfigRepo.findOneBy.mockResolvedValue(null);

      await expect(service.setActive('kora', true)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deactivates siblings when activating', async () => {
      mockProviderRepo.findOneBy.mockResolvedValue({
        id: 'kora',
        name: 'Korapay',
      });
      mockConfigRepo.findOneBy.mockResolvedValue({
        tenantId: 'tenant-1',
        providerId: 'kora',
        isActive: false,
      });

      await service.setActive('kora', true);

      expect(mockQueryBuilder.execute).toHaveBeenCalled();
    });

    it('does not deactivate siblings when merely turning a provider off', async () => {
      mockProviderRepo.findOneBy.mockResolvedValue({
        id: 'kora',
        name: 'Korapay',
      });
      mockConfigRepo.findOneBy.mockResolvedValue({
        tenantId: 'tenant-1',
        providerId: 'kora',
        isActive: true,
      });

      await service.setActive('kora', false);

      expect(mockQueryBuilder.execute).not.toHaveBeenCalled();
    });
  });

  describe('listProviders', () => {
    it('returns the catalog plus this tenant own config summaries', async () => {
      mockProviderRepo.find.mockResolvedValue([
        { id: 'paystack', name: 'Paystack' },
        { id: 'stripe', name: 'Stripe' },
      ]);
      mockConfigRepo.find.mockResolvedValue([
        { providerId: 'stripe', isActive: true },
      ]);

      const result = await service.listProviders();

      expect(result.tenantId).toBe('tenant-1');
      expect(result.catalog).toHaveLength(2);
      expect(result.ownConfigs).toEqual([
        { providerId: 'stripe', providerName: 'Stripe', isActive: true },
      ]);
    });
  });
});
