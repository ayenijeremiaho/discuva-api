import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminAuthService } from '../service/platform-admin-auth.service';
import { PlatformTenantService } from '../service/platform-tenant.service';
import { PlatformPlanService } from '../service/platform-plan.service';
import { PlatformCapabilityService } from '../service/platform-capability.service';
import { PlatformCommunicationProviderService } from '../service/platform-communication-provider.service';
import { PlatformGivingProviderService } from '../service/platform-giving-provider.service';
import { PlatformPaymentProviderService } from '../service/platform-payment-provider.service';
import { TenantBroadcastService } from '../service/tenant-broadcast.service';
import { CheckoutService } from '../../billing/service/checkout.service';
import { PlatformAdminGuard } from '../guard/platform-admin.guard';
import { PlatformSettingsService } from '../service/platform-settings.service';

// Scoped to the billing/giving-support routes added this pass — the rest of
// this controller predates unit-test coverage in this codebase and isn't
// this change's concern.
const mockCheckoutService = {
  listCheckoutSessions: jest.fn(),
  refundCheckoutSession: jest.fn(),
};
const mockGivingProviderService = {
  getTenantGivingProviders: jest.fn(),
  listProviders: jest.fn(),
  registerProvider: jest.fn(),
  setActive: jest.fn(),
};
const mockCommunicationProviderService = {
  setActive: jest.fn(),
};
const mockPaymentProviderService = {
  listProviders: jest.fn(),
  setActive: jest.fn(),
};
const mockTenantBroadcastService = {
  broadcastPlainTextToAllTenantAdmins: jest.fn(),
};
const mockAuthService = {
  forgotPassword: jest.fn(),
  resetPassword: jest.fn(),
  login: jest.fn(),
  refreshAccessToken: jest.fn(),
};
const mockPlatformSettingsService = {
  findAll: jest.fn(),
  upsert: jest.fn(),
};
const mockConfigService = {
  get: jest.fn((key: string) =>
    key === 'PLATFORM_ADMIN_REFRESH_JWT_EXPIRY_IN' ? '7d' : 'production',
  ),
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
        { provide: PlatformCapabilityService, useValue: { list: jest.fn() } },
        {
          provide: PlatformCommunicationProviderService,
          useValue: mockCommunicationProviderService,
        },
        {
          provide: PlatformGivingProviderService,
          useValue: mockGivingProviderService,
        },
        {
          provide: PlatformPaymentProviderService,
          useValue: mockPaymentProviderService,
        },
        { provide: CheckoutService, useValue: mockCheckoutService },
        {
          provide: TenantBroadcastService,
          useValue: mockTenantBroadcastService,
        },
        {
          provide: PlatformSettingsService,
          useValue: mockPlatformSettingsService,
        },
        { provide: ConfigService, useValue: mockConfigService },
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

  it('setCommunicationProviderActive delegates to PlatformCommunicationProviderService', async () => {
    await controller.setCommunicationProviderActive('termii', {
      isActive: false,
    });
    expect(mockCommunicationProviderService.setActive).toHaveBeenCalledWith(
      'termii',
      false,
    );
  });

  it('broadcastToTenants delegates to TenantBroadcastService with subject and plain-text message', async () => {
    mockTenantBroadcastService.broadcastPlainTextToAllTenantAdmins.mockResolvedValue(
      { sent: 3, skipped: 0, failed: 0 },
    );
    const result = await controller.broadcastToTenants({
      subject: 'Heads up',
      message: 'SMS is temporarily down.',
    });
    expect(
      mockTenantBroadcastService.broadcastPlainTextToAllTenantAdmins,
    ).toHaveBeenCalledWith('Heads up', 'SMS is temporarily down.');
    expect(result).toEqual({ sent: 3, skipped: 0, failed: 0 });
  });

  it('getTenantGivingProviders delegates to PlatformGivingProviderService', async () => {
    await controller.getTenantGivingProviders('tenant-1');
    expect(
      mockGivingProviderService.getTenantGivingProviders,
    ).toHaveBeenCalledWith('tenant-1');
  });

  it('listGivingProviders delegates to PlatformGivingProviderService', async () => {
    mockGivingProviderService.listProviders.mockResolvedValue([
      { id: 'paystack' },
    ]);
    const result = await controller.listGivingProviders();
    expect(mockGivingProviderService.listProviders).toHaveBeenCalled();
    expect(result).toEqual([{ id: 'paystack' }]);
  });

  it('registerGivingProvider delegates to PlatformGivingProviderService', async () => {
    const dto = { id: 'kora', name: 'Kora' };
    await controller.registerGivingProvider(dto);
    expect(mockGivingProviderService.registerProvider).toHaveBeenCalledWith(
      dto,
    );
  });

  it('setGivingProviderActive delegates to PlatformGivingProviderService', async () => {
    await controller.setGivingProviderActive('kora', { isActive: false });
    expect(mockGivingProviderService.setActive).toHaveBeenCalledWith(
      'kora',
      false,
    );
  });

  it('listPaymentProviders delegates to PlatformPaymentProviderService', async () => {
    mockPaymentProviderService.listProviders.mockResolvedValue([
      { id: 'paystack' },
    ]);
    const result = await controller.listPaymentProviders();
    expect(mockPaymentProviderService.listProviders).toHaveBeenCalled();
    expect(result).toEqual([{ id: 'paystack' }]);
  });

  it('setPaymentProviderActive delegates to PlatformPaymentProviderService', async () => {
    await controller.setPaymentProviderActive('paystack', {
      isActive: false,
    });
    expect(mockPaymentProviderService.setActive).toHaveBeenCalledWith(
      'paystack',
      false,
    );
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

  describe('auth session (login/refresh/logout)', () => {
    function mockResponse() {
      return { cookie: jest.fn(), clearCookie: jest.fn() } as any;
    }

    it('login sets the refresh cookie and strips refreshToken from the response body', async () => {
      mockAuthService.login.mockResolvedValue({
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        requiresPasswordChange: false,
      });
      const res = mockResponse();

      const body = await controller.login(
        { email: 'a@b.com', password: 'pw' } as any,
        res,
      );

      expect(body).toEqual({
        accessToken: 'access-1',
        requiresPasswordChange: false,
      });
      expect(res.cookie).toHaveBeenCalledWith(
        'platform_refresh_token',
        'refresh-1',
        expect.objectContaining({ httpOnly: true, path: '/v1/platform/auth' }),
      );
    });

    it('refresh delegates to refreshAccessToken with the authenticated admin id and re-sets the cookie', async () => {
      mockAuthService.refreshAccessToken.mockResolvedValue({
        accessToken: 'access-2',
        refreshToken: 'refresh-2',
      });
      const res = mockResponse();
      const req = { user: { id: 'admin-1' } } as any;

      const body = await controller.refresh(req, res);

      expect(mockAuthService.refreshAccessToken).toHaveBeenCalledWith(
        'admin-1',
      );
      expect(body).toEqual({ accessToken: 'access-2' });
      expect(res.cookie).toHaveBeenCalledWith(
        'platform_refresh_token',
        'refresh-2',
        expect.objectContaining({ httpOnly: true }),
      );
    });

    it('logout clears the refresh cookie', async () => {
      const res = mockResponse();

      await controller.logout(res);

      expect(res.clearCookie).toHaveBeenCalledWith(
        'platform_refresh_token',
        expect.objectContaining({ httpOnly: true, path: '/v1/platform/auth' }),
      );
    });
  });
});
