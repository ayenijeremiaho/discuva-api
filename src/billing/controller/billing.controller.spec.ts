import { Test, TestingModule } from '@nestjs/testing';
import { BillingController } from './billing.controller';
import { CheckoutService } from '../service/checkout.service';
import { AdminGuard } from '../../admin/guard/admin.guard';

const mockCheckoutService = {
  getBillingSummary: jest.fn(),
  listPlans: jest.fn(),
  initiateSubscriptionCheckout: jest.fn(),
  cancelSubscription: jest.fn(),
};

const mockAdmin = { member: { email: 'admin@example.com' } } as any;

describe('BillingController', () => {
  let controller: BillingController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [{ provide: CheckoutService, useValue: mockCheckoutService }],
    })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(BillingController);
  });

  it('getSummary delegates to CheckoutService', () => {
    controller.getSummary();
    expect(mockCheckoutService.getBillingSummary).toHaveBeenCalled();
  });

  it('listPlans delegates to CheckoutService', () => {
    controller.listPlans();
    expect(mockCheckoutService.listPlans).toHaveBeenCalled();
  });

  it('initiateSubscriptionCheckout passes the current admin email through', () => {
    controller.initiateSubscriptionCheckout(
      {
        planId: 'pro',
        provider: 'paystack',
        successUrl: 'https://a',
        cancelUrl: 'https://b',
      },
      mockAdmin,
    );
    expect(
      mockCheckoutService.initiateSubscriptionCheckout,
    ).toHaveBeenCalledWith(
      'pro',
      'admin@example.com',
      'paystack',
      'https://a',
      'https://b',
    );
  });

  it('cancelSubscription delegates to CheckoutService', () => {
    controller.cancelSubscription();
    expect(mockCheckoutService.cancelSubscription).toHaveBeenCalled();
  });
});
