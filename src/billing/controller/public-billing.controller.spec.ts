import { Test, TestingModule } from '@nestjs/testing';
import { PublicBillingController } from './public-billing.controller';
import { CheckoutService } from '../service/checkout.service';

const mockCheckoutService = { listPublicPlans: jest.fn() };

describe('PublicBillingController', () => {
  let controller: PublicBillingController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicBillingController],
      providers: [{ provide: CheckoutService, useValue: mockCheckoutService }],
    }).compile();
    controller = module.get(PublicBillingController);
  });

  describe('listPublicPlans', () => {
    it('delegates to CheckoutService.listPublicPlans with no guard/tenant context required', async () => {
      const tiers = [
        {
          tierKey: 'pro',
          name: 'Pro',
          features: ['sms'],
          featureLimits: {},
          variants: [{ planId: 'pro', currency: 'NGN', priceCents: 5000000 }],
        },
      ];
      mockCheckoutService.listPublicPlans.mockResolvedValue(tiers);

      const result = await controller.listPublicPlans();

      expect(result).toBe(tiers);
      expect(mockCheckoutService.listPublicPlans).toHaveBeenCalledWith();
    });
  });
});
