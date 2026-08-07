import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { TenantCommunicationProviderService } from './tenant-communication-provider.service';
import { CommunicationProvider } from '../../platform-admin/entity/communication-provider.entity';
import { TenantCommunicationProviderConfig } from '../../platform-admin/entity/tenant-communication-provider-config.entity';
import { EncryptionService } from '../../utility/service/encryption.service';
import { CacheService } from '../../utility/service/cache.service';

const mockCls = { get: jest.fn().mockReturnValue('tenant-1') };
const mockEncryptionService = {
  encryptFields: jest.fn((v) => v),
  decryptFields: jest.fn((v) => v),
};
const mockCacheService = { del: jest.fn() };
const mockProviderRepo = { findOneBy: jest.fn(), find: jest.fn() };
const mockConfigRepo = { findOneBy: jest.fn(), create: jest.fn((v) => v) };

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

describe('TenantCommunicationProviderService', () => {
  let service: TenantCommunicationProviderService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCls.get.mockReturnValue('tenant-1');
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantCommunicationProviderService,
        { provide: ClsService, useValue: mockCls },
        { provide: EncryptionService, useValue: mockEncryptionService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        {
          provide: getRepositoryToken(CommunicationProvider),
          useValue: mockProviderRepo,
        },
        {
          provide: getRepositoryToken(TenantCommunicationProviderConfig),
          useValue: mockConfigRepo,
        },
      ],
    }).compile();
    service = module.get(TenantCommunicationProviderService);
  });

  describe('upsertConfig', () => {
    it('throws NotFoundException for a providerId not registered on that channel', async () => {
      mockProviderRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.upsertConfig('sms', {
          providerId: 'unknown',
          credentials: { apiKey: 'x' },
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('deactivates every other SMS provider for this tenant when saving a new active one', async () => {
      mockProviderRepo.findOneBy.mockResolvedValue({
        id: 'twilio',
        channel: 'sms',
        name: 'Twilio',
      });
      mockConfigRepo.findOneBy.mockResolvedValue(null);
      mockProviderRepo.find.mockResolvedValue([
        { id: 'termii', channel: 'sms', name: 'Termii' },
        { id: 'twilio', channel: 'sms', name: 'Twilio' },
      ]);

      await service.upsertConfig('sms', {
        providerId: 'twilio',
        credentials: { accountSid: 'AC1', authToken: 'x', fromNumber: '+1' },
      });

      expect(mockManager.save).toHaveBeenCalled();
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'tenantId = :tenantId',
        { tenantId: 'tenant-1' },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'providerId IN (:...siblingIds)',
        { siblingIds: ['termii'] },
      );
      expect(mockCacheService.del).toHaveBeenCalledWith(
        'communication-provider-config:tenant-1:sms',
      );
    });

    it('does not touch sibling rows when this is the only provider on the channel', async () => {
      mockProviderRepo.findOneBy.mockResolvedValue({
        id: 'termii',
        channel: 'sms',
        name: 'Termii',
      });
      mockConfigRepo.findOneBy.mockResolvedValue(null);
      mockProviderRepo.find.mockResolvedValue([
        { id: 'termii', channel: 'sms', name: 'Termii' },
      ]);

      await service.upsertConfig('sms', {
        providerId: 'termii',
        credentials: { apiKey: 'x', senderId: 'y' },
      });

      expect(mockQueryBuilder.execute).not.toHaveBeenCalled();
    });
  });

  describe('setActive', () => {
    it('throws NotFoundException when no config exists yet for that provider', async () => {
      mockProviderRepo.findOneBy.mockResolvedValue({
        id: 'termii',
        channel: 'sms',
        name: 'Termii',
      });
      mockConfigRepo.findOneBy.mockResolvedValue(null);

      await expect(service.setActive('sms', 'termii', true)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deactivates sibling providers on the same channel when activating', async () => {
      mockProviderRepo.findOneBy.mockResolvedValue({
        id: 'twilio',
        channel: 'sms',
        name: 'Twilio',
      });
      mockConfigRepo.findOneBy.mockResolvedValue({
        tenantId: 'tenant-1',
        providerId: 'twilio',
        isActive: false,
      });
      mockProviderRepo.find.mockResolvedValue([
        { id: 'termii', channel: 'sms', name: 'Termii' },
        { id: 'twilio', channel: 'sms', name: 'Twilio' },
      ]);

      await service.setActive('sms', 'twilio', true);

      expect(mockQueryBuilder.execute).toHaveBeenCalled();
    });

    it('does not deactivate siblings when merely turning a provider off', async () => {
      mockProviderRepo.findOneBy.mockResolvedValue({
        id: 'twilio',
        channel: 'sms',
        name: 'Twilio',
      });
      mockConfigRepo.findOneBy.mockResolvedValue({
        tenantId: 'tenant-1',
        providerId: 'twilio',
        isActive: true,
      });

      await service.setActive('sms', 'twilio', false);

      expect(mockProviderRepo.find).not.toHaveBeenCalled();
      expect(mockQueryBuilder.execute).not.toHaveBeenCalled();
    });
  });
});
