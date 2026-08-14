import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PlatformPlanService } from './platform-plan.service';
import { Plan } from '../../billing/entity/plan.entity';
import { Subscription } from '../../billing/entity/subscription.entity';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';

const mockPlanRepo = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  save: jest.fn(),
  create: jest.fn((v) => v),
};
const mockSubscriptionRepo = { find: jest.fn() };

describe('PlatformPlanService', () => {
  let service: PlatformPlanService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPlanRepo.save.mockImplementation((p) => Promise.resolve(p));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformPlanService,
        { provide: getRepositoryToken(Plan), useValue: mockPlanRepo },
        {
          provide: getRepositoryToken(Subscription),
          useValue: mockSubscriptionRepo,
        },
      ],
    }).compile();
    service = module.get(PlatformPlanService);
  });

  describe('createPlan', () => {
    it('rejects a featureLimits key that is not a known PlanFeature', async () => {
      mockPlanRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.createPlan({
          id: 'pro',
          name: 'Pro',
          featureLimits: { not_a_real_feature: 1 },
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a non-positive-integer limit', async () => {
      mockPlanRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.createPlan({
          id: 'pro',
          name: 'Pro',
          featureLimits: { [PlanFeature.SMS]: 0 },
        } as any),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createPlan({
          id: 'pro',
          name: 'Pro',
          featureLimits: { [PlanFeature.SMS]: 1.5 },
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a valid featureLimits map', async () => {
      mockPlanRepo.findOneBy.mockResolvedValue(null);

      const result = await service.createPlan({
        id: 'free',
        name: 'Free',
        featureLimits: { [PlanFeature.SMS]: 1 },
      } as any);

      expect(result.featureLimits).toEqual({ [PlanFeature.SMS]: 1 });
    });

    it('accepts a KNOWN_MODULES key as a featureLimits entry, not just a PlanFeature value', async () => {
      mockPlanRepo.findOneBy.mockResolvedValue(null);

      const result = await service.createPlan({
        id: 'free',
        name: 'Free',
        featureLimits: { prayer: 3 },
      } as any);

      expect(result.featureLimits).toEqual({ prayer: 3 });
    });

    it('still throws ConflictException for a duplicate id regardless of featureLimits', async () => {
      mockPlanRepo.findOneBy.mockResolvedValue({ id: 'pro' });

      await expect(
        service.createPlan({ id: 'pro', name: 'Pro' } as any),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updatePlan', () => {
    it('rejects an invalid featureLimits value on update', async () => {
      mockPlanRepo.findOneBy.mockResolvedValue({ id: 'pro', name: 'Pro' });

      await expect(
        service.updatePlan('pro', {
          featureLimits: { [PlanFeature.SMS]: -1 },
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('applies a valid featureLimits update', async () => {
      mockPlanRepo.findOneBy.mockResolvedValue({ id: 'pro', name: 'Pro' });

      const result = await service.updatePlan('pro', {
        featureLimits: { [PlanFeature.SMS]: 5 },
      } as any);

      expect(result.featureLimits).toEqual({ [PlanFeature.SMS]: 5 });
    });

    it('rejects a currency change once billingProviderPriceId is set', async () => {
      mockPlanRepo.findOneBy.mockResolvedValue({
        id: 'pro',
        name: 'Pro',
        currency: 'NGN',
        billingProviderPriceId: 'PLN_abc123',
      });

      await expect(
        service.updatePlan('pro', { currency: 'USD' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows a currency change when billingProviderPriceId is not yet set', async () => {
      mockPlanRepo.findOneBy.mockResolvedValue({
        id: 'pro-usd',
        name: 'Pro',
        currency: 'NGN',
        billingProviderPriceId: null,
      });

      const result = await service.updatePlan('pro-usd', {
        currency: 'USD',
      } as any);

      expect(result.currency).toBe('USD');
    });

    it('allows a non-currency, non-interval update even when billingProviderPriceId is set', async () => {
      mockPlanRepo.findOneBy.mockResolvedValue({
        id: 'pro',
        name: 'Pro',
        currency: 'NGN',
        billingInterval: 'monthly',
        billingProviderPriceId: 'PLN_abc123',
      });

      const result = await service.updatePlan('pro', {
        name: 'Pro Plan',
      } as any);

      expect(result.name).toBe('Pro Plan');
    });

    it('rejects a billingInterval change once billingProviderPriceId is set', async () => {
      mockPlanRepo.findOneBy.mockResolvedValue({
        id: 'pro',
        name: 'Pro',
        currency: 'NGN',
        billingInterval: 'monthly',
        billingProviderPriceId: 'PLN_abc123',
      });

      await expect(
        service.updatePlan('pro', { billingInterval: 'annual' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows a billingInterval change when billingProviderPriceId is not yet set', async () => {
      mockPlanRepo.findOneBy.mockResolvedValue({
        id: 'pro-annual',
        name: 'Pro',
        currency: 'NGN',
        billingInterval: 'monthly',
        billingProviderPriceId: null,
      });

      const result = await service.updatePlan('pro-annual', {
        billingInterval: 'annual',
      } as any);

      expect(result.billingInterval).toBe('annual');
    });
  });
});
