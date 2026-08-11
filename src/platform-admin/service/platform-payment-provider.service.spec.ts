import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { PlatformPaymentProviderService } from './platform-payment-provider.service';
import { PlatformPaymentProvider } from '../../billing/entity/payment-provider.entity';
import { Subscription } from '../../billing/entity/subscription.entity';
import { TenantBroadcastService } from './tenant-broadcast.service';

const mockProviderRepo = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  save: jest.fn(),
};
const mockSubscriptionRepo = { find: jest.fn() };
const mockTenantBroadcastService = { notifyTenants: jest.fn() };

describe('PlatformPaymentProviderService', () => {
  let service: PlatformPaymentProviderService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSubscriptionRepo.find.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformPaymentProviderService,
        {
          provide: getRepositoryToken(PlatformPaymentProvider),
          useValue: mockProviderRepo,
        },
        {
          provide: getRepositoryToken(Subscription),
          useValue: mockSubscriptionRepo,
        },
        {
          provide: TenantBroadcastService,
          useValue: mockTenantBroadcastService,
        },
      ],
    }).compile();
    service = module.get(PlatformPaymentProviderService);
  });

  describe('listProviders', () => {
    it('lists providers ordered by name', async () => {
      mockProviderRepo.find.mockResolvedValue([{ id: 'paystack' }]);
      const result = await service.listProviders();
      expect(mockProviderRepo.find).toHaveBeenCalledWith({
        order: { name: 'ASC' },
      });
      expect(result).toEqual([{ id: 'paystack' }]);
    });
  });

  describe('setActive', () => {
    it('throws NotFoundException for an unknown provider id', async () => {
      mockProviderRepo.findOneBy.mockResolvedValue(null);
      await expect(service.setActive('nope', false)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('does not notify when no tenant has a live subscription on the provider', async () => {
      mockProviderRepo.findOneBy.mockResolvedValue({
        id: 'paystack',
        name: 'Paystack',
        isActive: true,
      });
      mockProviderRepo.save.mockImplementation((p) => Promise.resolve(p));
      mockSubscriptionRepo.find.mockResolvedValue([]);

      await service.setActive('paystack', false);

      expect(mockTenantBroadcastService.notifyTenants).not.toHaveBeenCalled();
    });

    it('notifies every tenant with a non-canceled subscription on the provider when deactivating', async () => {
      mockProviderRepo.findOneBy.mockResolvedValue({
        id: 'paystack',
        name: 'Paystack',
        isActive: true,
      });
      mockProviderRepo.save.mockImplementation((p) => Promise.resolve(p));
      mockSubscriptionRepo.find.mockResolvedValue([
        { tenantId: 'tenant-1', paymentProvider: 'paystack' },
        { tenantId: 'tenant-2', paymentProvider: 'paystack' },
      ]);

      await service.setActive('paystack', false);

      expect(mockTenantBroadcastService.notifyTenants).toHaveBeenCalledWith(
        ['tenant-1', 'tenant-2'],
        expect.stringContaining('unavailable'),
        expect.stringContaining('not affected'),
      );
    });

    it('sends a "restored" notice, not a "disrupted" one, when reactivating', async () => {
      mockProviderRepo.findOneBy.mockResolvedValue({
        id: 'paystack',
        name: 'Paystack',
        isActive: false,
      });
      mockProviderRepo.save.mockImplementation((p) => Promise.resolve(p));
      mockSubscriptionRepo.find.mockResolvedValue([
        { tenantId: 'tenant-1', paymentProvider: 'paystack' },
      ]);

      await service.setActive('paystack', true);

      expect(mockTenantBroadcastService.notifyTenants).toHaveBeenCalledWith(
        ['tenant-1'],
        expect.stringContaining('available again'),
        expect.any(String),
      );
    });
  });
});
