import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PlatformCommunicationProviderService } from './platform-communication-provider.service';
import { CommunicationProvider } from '../entity/communication-provider.entity';
import { TenantCommunicationProviderConfig } from '../entity/tenant-communication-provider-config.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';

const mockProviderRepo = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  findBy: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};
const mockTenantProviderConfigRepo = { find: jest.fn() };
const mockTenantRepo = { findOneBy: jest.fn() };

describe('PlatformCommunicationProviderService', () => {
  let service: PlatformCommunicationProviderService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformCommunicationProviderService,
        {
          provide: getRepositoryToken(CommunicationProvider),
          useValue: mockProviderRepo,
        },
        {
          provide: getRepositoryToken(TenantCommunicationProviderConfig),
          useValue: mockTenantProviderConfigRepo,
        },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
      ],
    }).compile();
    service = module.get(PlatformCommunicationProviderService);
  });

  describe('listProviders', () => {
    it('lists providers ordered by channel then name', async () => {
      mockProviderRepo.find.mockResolvedValue([{ id: 'termii' }]);
      const result = await service.listProviders();
      expect(mockProviderRepo.find).toHaveBeenCalledWith({
        order: { channel: 'ASC', name: 'ASC' },
      });
      expect(result).toEqual([{ id: 'termii' }]);
    });
  });

  describe('registerProvider', () => {
    it('creates a new provider when the id is unused', async () => {
      mockProviderRepo.findOneBy.mockResolvedValue(null);
      mockProviderRepo.create.mockReturnValue({ id: 'termii' });
      mockProviderRepo.save.mockResolvedValue({ id: 'termii' });

      const dto = { id: 'termii', channel: 'sms' as const, name: 'Termii' };
      const result = await service.registerProvider(dto);

      expect(mockProviderRepo.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ id: 'termii' });
    });

    it('throws when a provider with that id already exists', async () => {
      mockProviderRepo.findOneBy.mockResolvedValue({ id: 'termii' });
      await expect(
        service.registerProvider({
          id: 'termii',
          channel: 'sms',
          name: 'Termii',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('setActive', () => {
    it('flips isActive and saves', async () => {
      const provider = { id: 'termii', isActive: true };
      mockProviderRepo.findOneBy.mockResolvedValue(provider);
      mockProviderRepo.save.mockImplementation((p) => Promise.resolve(p));

      const result = await service.setActive('termii', false);

      expect(mockProviderRepo.findOneBy).toHaveBeenCalledWith({
        id: 'termii',
      });
      expect(result.isActive).toBe(false);
    });

    it('throws NotFoundException for an unknown provider id', async () => {
      mockProviderRepo.findOneBy.mockResolvedValue(null);
      await expect(service.setActive('nope', false)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockProviderRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('getTenantProviders', () => {
    it('throws NotFoundException when the tenant does not exist', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue(null);
      await expect(service.getTenantProviders('t1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('joins tenant configs with provider catalog data, never exposing credentials', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue({ id: 't1' });
      mockTenantProviderConfigRepo.find.mockResolvedValue([
        { providerId: 'termii', senderIdentity: 'Church', isActive: true },
      ]);
      mockProviderRepo.findBy.mockResolvedValue([
        { id: 'termii', channel: 'sms', name: 'Termii' },
      ]);

      const result = await service.getTenantProviders('t1');

      expect(result.providers).toEqual([
        {
          providerId: 'termii',
          channel: 'sms',
          providerName: 'Termii',
          senderIdentity: 'Church',
          isActive: true,
        },
      ]);
    });
  });
});
