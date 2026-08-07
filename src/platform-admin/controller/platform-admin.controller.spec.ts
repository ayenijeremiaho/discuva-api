import { Test, TestingModule } from '@nestjs/testing';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminAuthService } from '../service/platform-admin-auth.service';
import { PlatformTenantService } from '../service/platform-tenant.service';
import { PlatformPlanService } from '../service/platform-plan.service';
import { PlatformCommunicationProviderService } from '../service/platform-communication-provider.service';
import { PlatformGivingProviderService } from '../service/platform-giving-provider.service';
import { CheckoutService } from '../../billing/service/checkout.service';
import { PlatformAdminGuard } from '../guard/platform-admin.guard';

// Scoped to the billing/giving-support routes added this pass — the rest of
// this controller predates unit-test coverage in this codebase and isn't
// this change's concern.
const mockCheckoutService = {
  listCheckoutSessions: jest.fn(),
  refundCheckoutSession: jest.fn(),
};
const mockGivingProviderService = {
  getTenantGivingProviders: jest.fn(),
};
const mockAuthService = {
  forgotPassword: jest.fn(),
  resetPassword: jest.fn(),
};

describe('PlatformAdminController (billing support routes)', () => {
  let controller: PlatformAdminController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlatformAdminController],
      providers: [
        { provide: PlatformAdminAuthService, useValue: mockAuthService },
        { provide: PlatformTenantService, useValue: {} },
        { provide: PlatformPlanService, useValue: {} },
        { provide: PlatformCommunicationProviderService, useValue: {} },
        {
          provide: PlatformGivingProviderService,
          useValue: mockGivingProviderService,
        },
        { provide: CheckoutService, useValue: mockCheckoutService },
      ],
    })
      .overrideGuard(PlatformAdminGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(PlatformAdminController);
  });

  it('listTenantBillingSessions delegates to CheckoutService', async () => {
    await controller.listTenantBillingSessions('tenant-1');
    expect(mockCheckoutService.listCheckoutSessions).toHaveBeenCalledWith(
      'tenant-1',
    );
  });

  it('refundCheckoutSession delegates to CheckoutService with the optional amount', async () => {
    await controller.refundCheckoutSession('sess-1', { amountCents: 5000 });
    expect(mockCheckoutService.refundCheckoutSession).toHaveBeenCalledWith(
      'sess-1',
      5000,
    );
  });

  it('refundCheckoutSession passes undefined for a full refund', async () => {
    await controller.refundCheckoutSession('sess-1', {});
    expect(mockCheckoutService.refundCheckoutSession).toHaveBeenCalledWith(
      'sess-1',
      undefined,
    );
  });

  it('getTenantGivingProviders delegates to PlatformGivingProviderService', async () => {
    await controller.getTenantGivingProviders('tenant-1');
    expect(
      mockGivingProviderService.getTenantGivingProviders,
    ).toHaveBeenCalledWith('tenant-1');
  });

  it('forgotPassword delegates to PlatformAdminAuthService and returns a generic message', async () => {
    const result = await controller.forgotPassword({
      email: 'admin@example.com',
    } as any);
    expect(mockAuthService.forgotPassword).toHaveBeenCalledWith(
      'admin@example.com',
    );
    expect(result.message).toContain('reset code has been sent');
  });

  it('resetPassword delegates to PlatformAdminAuthService with the full dto', async () => {
    const dto = {
      email: 'admin@example.com',
      otp: '123456',
      newPassword: 'NewSecure1!',
    };
    const result = await controller.resetPassword(dto as any);
    expect(mockAuthService.resetPassword).toHaveBeenCalledWith(dto);
    expect(result.message).toContain('reset successfully');
  });
});
