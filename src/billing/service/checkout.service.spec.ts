import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { Plan } from '../entity/plan.entity';
import { Subscription } from '../entity/subscription.entity';
import { SubscriptionStatus } from '../enum/subscription-status.enum';
import { BillingCheckoutSession } from '../entity/billing-checkout-session.entity';
import { SmsWallet } from '../../platform-admin/entity/sms-wallet.entity';
import { SmsWalletTransaction } from '../../platform-admin/entity/sms-wallet-transaction.entity';
import { CacheService } from '../../utility/service/cache.service';
import { PaymentProviderRegistryService } from './payment-provider-registry.service';

const mockTenantRepo = { findOneByOrFail: jest.fn() };
const mockPlanRepo = { findOneBy: jest.fn(), find: jest.fn() };
const mockSubscriptionRepo = {
  findOneBy: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
};
const mockCheckoutRepo = {
  create: jest.fn((v) => v),
  save: jest.fn(),
  update: jest.fn(),
  findOneBy: jest.fn(),
  find: jest.fn(),
};
const mockWalletRepo = { findOneBy: jest.fn() };

const mockManager = {
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn((_entity, v) => v),
};
const mockDataSource = {
  transaction: jest.fn((cb) => cb(mockManager)),
};

const mockCls = { get: jest.fn().mockReturnValue('tenant-1') };
const mockCacheService = {
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(1),
};

const mockProvider = {
  providerName: 'paystack',
  createCustomer: jest.fn().mockResolvedValue({ providerCustomerId: 'CUS_1' }),
  createSubscriptionCheckout: jest.fn(),
  createOneOffCheckout: jest.fn(),
  cancelSubscription: jest.fn().mockResolvedValue(undefined),
  refund: jest.fn().mockResolvedValue(undefined),
  verifyAndParseWebhook: jest.fn(),
};
const mockRegistry = { get: jest.fn().mockReturnValue(mockProvider) };

async function buildService(
  configGet: (key: string) => unknown = () => undefined,
): Promise<CheckoutService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      CheckoutService,
      { provide: ClsService, useValue: mockCls },
      { provide: ConfigService, useValue: { get: jest.fn(configGet) } },
      { provide: CacheService, useValue: mockCacheService },
      { provide: PaymentProviderRegistryService, useValue: mockRegistry },
      { provide: getDataSourceToken(), useValue: mockDataSource },
      { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
      { provide: getRepositoryToken(Plan), useValue: mockPlanRepo },
      {
        provide: getRepositoryToken(Subscription),
        useValue: mockSubscriptionRepo,
      },
      {
        provide: getRepositoryToken(BillingCheckoutSession),
        useValue: mockCheckoutRepo,
      },
      { provide: getRepositoryToken(SmsWallet), useValue: mockWalletRepo },
      { provide: getRepositoryToken(SmsWalletTransaction), useValue: {} },
    ],
  }).compile();
  return module.get(CheckoutService);
}

describe('CheckoutService', () => {
  let service: CheckoutService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCls.get.mockReturnValue('tenant-1');
    mockRegistry.get.mockReturnValue(mockProvider);
    mockManager.create.mockImplementation((_entity, v) => v);
    service = await buildService();
  });

  describe('tenant context guard', () => {
    it('throws when called with no tenant in CLS', async () => {
      mockCls.get.mockReturnValue(undefined);
      await expect(service.getBillingSummary()).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('listPlans', () => {
    it('returns every plan ordered by price ascending', async () => {
      const plans = [
        { id: 'free', name: 'Free', priceCents: 0 },
        { id: 'pro', name: 'Pro', priceCents: 500000 },
      ];
      mockPlanRepo.find.mockResolvedValue(plans);

      const result = await service.listPlans();

      expect(mockPlanRepo.find).toHaveBeenCalledWith({
        order: { priceCents: 'ASC' },
      });
      expect(result).toBe(plans);
    });
  });

  describe('getBillingSummary', () => {
    it('defaults to the free plan and zero balance when nothing is configured', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);
      mockWalletRepo.findOneBy.mockResolvedValue(null);
      mockPlanRepo.findOneBy.mockResolvedValue({ id: 'free', name: 'Free' });

      const result = await service.getBillingSummary();
      expect(result).toEqual(
        expect.objectContaining({
          planId: 'free',
          planName: 'Free',
          walletBalanceCredits: 0,
        }),
      );
    });

    it('reflects an active paid subscription and wallet balance', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue({
        planId: 'pro',
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: new Date('2026-09-01'),
      });
      mockWalletRepo.findOneBy.mockResolvedValue({ balanceCredits: 500 });
      mockPlanRepo.findOneBy.mockResolvedValue({ id: 'pro', name: 'Pro' });

      const result = await service.getBillingSummary();
      expect(result.planId).toBe('pro');
      expect(result.walletBalanceCredits).toBe(500);
    });
  });

  describe('initiateSubscriptionCheckout', () => {
    it('throws NotFoundException for an unknown plan', async () => {
      mockPlanRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.initiateSubscriptionCheckout(
          'nonexistent',
          'admin@example.com',
          undefined,
          'https://a',
          'https://b',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates a customer, initiates checkout, and records a pending session', async () => {
      mockPlanRepo.findOneBy.mockResolvedValue({
        id: 'pro',
        priceCents: 500000,
        currency: 'NGN',
      });
      mockTenantRepo.findOneByOrFail.mockResolvedValue({
        id: 'tenant-1',
        name: 'Test Church',
      });
      mockProvider.createSubscriptionCheckout.mockResolvedValue({
        checkoutUrl: 'https://pay',
        providerSessionId: 'sub_abc',
      });

      const result = await service.initiateSubscriptionCheckout(
        'pro',
        'admin@example.com',
        'paystack',
        'https://a',
        'https://b',
      );

      expect(mockRegistry.get).toHaveBeenCalledWith('paystack');
      expect(mockCheckoutRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'sub_abc',
          tenantId: 'tenant-1',
          planId: 'pro',
          status: 'pending',
        }),
      );
      expect(result.checkoutUrl).toBe('https://pay');
    });
  });

  describe('initiateWalletTopupCheckout', () => {
    it('throws ForbiddenException when SMS_CREDIT_PRICE_KOBO is not configured', async () => {
      await expect(
        service.initiateWalletTopupCheckout(
          100,
          'admin@example.com',
          undefined,
          'https://a',
          'https://b',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('computes amountCents from credits and records a pending wallet_topup session', async () => {
      const svc = await buildService((key) =>
        key === 'SMS_CREDIT_PRICE_KOBO' ? 100 : undefined,
      );
      mockTenantRepo.findOneByOrFail.mockResolvedValue({
        id: 'tenant-1',
        name: 'Test Church',
      });
      mockProvider.createOneOffCheckout.mockResolvedValue({
        checkoutUrl: 'https://pay',
        providerSessionId: 'topup_abc',
      });

      const result = await svc.initiateWalletTopupCheckout(
        1000,
        'admin@example.com',
        undefined,
        'https://a',
        'https://b',
      );

      expect(mockProvider.createOneOffCheckout).toHaveBeenCalledWith(
        expect.objectContaining({ amountCents: 100000 }),
      );
      expect(mockCheckoutRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'topup_abc',
          type: 'wallet_topup',
          creditsAmount: 1000,
          amountCents: 100000,
        }),
      );
      expect(result.checkoutUrl).toBe('https://pay');
    });
  });

  describe('handleWebhookEvent', () => {
    it('is a safe no-op when the session reference is unknown (already processed or forged)', async () => {
      mockProvider.verifyAndParseWebhook.mockReturnValue({
        type: 'charge.succeeded',
        providerReference: 'unknown-ref',
        raw: {},
      });
      mockManager.findOne.mockResolvedValue(null);

      await expect(
        service.handleWebhookEvent('paystack', Buffer.from('{}'), 'sig'),
      ).resolves.toBeUndefined();
      expect(mockManager.save).not.toHaveBeenCalled();
    });

    it('activates a subscription on charge.succeeded for a pending subscription session', async () => {
      mockProvider.verifyAndParseWebhook.mockReturnValue({
        type: 'charge.succeeded',
        providerReference: 'sub_abc',
        raw: {},
      });
      mockManager.findOne
        .mockResolvedValueOnce({
          id: 'sub_abc',
          tenantId: 'tenant-1',
          type: 'subscription',
          planId: 'pro',
          provider: 'paystack',
          status: 'pending',
        }) // BillingCheckoutSession lookup
        .mockResolvedValueOnce(null); // no existing Subscription row yet

      await service.handleWebhookEvent('paystack', Buffer.from('{}'), 'sig');

      expect(mockManager.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed' }),
      );
      expect(mockManager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          planId: 'pro',
          status: SubscriptionStatus.ACTIVE,
        }),
      );
      expect(mockCacheService.del).toHaveBeenCalledWith(
        'plan-features:tenant-1',
      );
    });

    it('credits the SMS wallet on charge.succeeded for a pending wallet_topup session', async () => {
      mockProvider.verifyAndParseWebhook.mockReturnValue({
        type: 'charge.succeeded',
        providerReference: 'topup_abc',
        raw: {},
      });
      mockManager.findOne
        .mockResolvedValueOnce({
          id: 'topup_abc',
          tenantId: 'tenant-1',
          type: 'wallet_topup',
          creditsAmount: 1000,
          provider: 'paystack',
          status: 'pending',
        }) // BillingCheckoutSession lookup
        .mockResolvedValueOnce({ tenantId: 'tenant-1', balanceCredits: 200 }); // existing wallet

      await service.handleWebhookEvent('paystack', Buffer.from('{}'), 'sig');

      expect(mockManager.save).toHaveBeenCalledWith(
        SmsWallet,
        expect.objectContaining({ tenantId: 'tenant-1', balanceCredits: 1200 }),
      );
      expect(mockManager.save).toHaveBeenCalledWith(
        SmsWalletTransaction,
        expect.objectContaining({ credits: 1000, balanceAfter: 1200 }),
      );
    });

    it('marks the session failed on charge.failed', async () => {
      mockProvider.verifyAndParseWebhook.mockReturnValue({
        type: 'charge.failed',
        providerReference: 'sub_abc',
        raw: {},
      });

      await service.handleWebhookEvent('paystack', Buffer.from('{}'), 'sig');

      expect(mockCheckoutRepo.update).toHaveBeenCalledWith(
        { id: 'sub_abc', status: 'pending' },
        { status: 'failed' },
      );
    });

    it('downgrades to free on subscription.canceled for a known subscription', async () => {
      mockProvider.verifyAndParseWebhook.mockReturnValue({
        type: 'subscription.canceled',
        providerSubscriptionId: 'SUB_123',
        raw: {},
      });
      mockSubscriptionRepo.findOneBy.mockResolvedValue({
        tenantId: 'tenant-1',
        planId: 'pro',
        status: SubscriptionStatus.ACTIVE,
      });
      mockSubscriptionRepo.save.mockResolvedValue({});

      await service.handleWebhookEvent('paystack', Buffer.from('{}'), 'sig');

      expect(mockSubscriptionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          planId: 'free',
          status: SubscriptionStatus.CANCELED,
          canceledAt: expect.any(Date),
        }),
      );
    });

    it('is a safe no-op on subscription.canceled with no matching subscription', async () => {
      mockProvider.verifyAndParseWebhook.mockReturnValue({
        type: 'subscription.canceled',
        providerSubscriptionId: 'SUB_unknown',
        raw: {},
      });
      mockSubscriptionRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.handleWebhookEvent('paystack', Buffer.from('{}'), 'sig'),
      ).resolves.toBeUndefined();
      expect(mockSubscriptionRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('cancelSubscription', () => {
    it('throws when the tenant has no paid subscription to cancel', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue({
        tenantId: 'tenant-1',
        planId: 'free',
      });
      await expect(service.cancelSubscription()).rejects.toThrow(
        'No active paid subscription to cancel.',
      );
    });

    it('throws when the plan is sponsored by a parent tenant', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue({
        tenantId: 'tenant-1',
        planId: 'pro',
        sponsoredByTenantId: 'parent-1',
      });
      await expect(service.cancelSubscription()).rejects.toThrow(
        'managed by your parent church',
      );
    });

    it('marks cancelAtPeriodEnd when still within a paid period, keeping access', async () => {
      const future = new Date();
      future.setDate(future.getDate() + 10);
      mockSubscriptionRepo.findOneBy.mockResolvedValue({
        tenantId: 'tenant-1',
        planId: 'pro',
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: future,
        paymentProvider: 'paystack',
        billingProviderSubscriptionId: 'SUB_123',
      });
      mockSubscriptionRepo.save.mockResolvedValue({});
      mockPlanRepo.findOneBy.mockResolvedValue({ id: 'pro', name: 'Pro' });
      mockWalletRepo.findOneBy.mockResolvedValue(null);

      await service.cancelSubscription();

      expect(mockProvider.cancelSubscription).toHaveBeenCalledWith('SUB_123');
      expect(mockSubscriptionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ cancelAtPeriodEnd: true, planId: 'pro' }),
      );
    });

    it('downgrades immediately when there is no active paid period left', async () => {
      mockSubscriptionRepo.findOneBy.mockResolvedValue({
        tenantId: 'tenant-1',
        planId: 'pro',
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: null,
        paymentProvider: null,
        billingProviderSubscriptionId: null,
      });
      mockSubscriptionRepo.save.mockResolvedValue({});
      mockPlanRepo.findOneBy.mockResolvedValue({ id: 'free', name: 'Free' });
      mockWalletRepo.findOneBy.mockResolvedValue(null);

      await service.cancelSubscription();

      expect(mockProvider.cancelSubscription).not.toHaveBeenCalled();
      expect(mockSubscriptionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          planId: 'free',
          status: SubscriptionStatus.CANCELED,
          canceledAt: expect.any(Date),
          cancelAtPeriodEnd: false,
        }),
      );
    });

    it('downgrades locally even when the provider cancel call fails', async () => {
      mockProvider.cancelSubscription.mockRejectedValueOnce(
        new Error('provider down'),
      );
      mockSubscriptionRepo.findOneBy.mockResolvedValue({
        tenantId: 'tenant-1',
        planId: 'pro',
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: null,
        paymentProvider: 'paystack',
        billingProviderSubscriptionId: 'SUB_123',
      });
      mockSubscriptionRepo.save.mockResolvedValue({});
      mockPlanRepo.findOneBy.mockResolvedValue({ id: 'free', name: 'Free' });
      mockWalletRepo.findOneBy.mockResolvedValue(null);

      await expect(service.cancelSubscription()).resolves.toBeDefined();
      expect(mockSubscriptionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: SubscriptionStatus.CANCELED }),
      );
    });
  });

  describe('refundCheckoutSession', () => {
    it('throws NotFoundException for an unknown session', async () => {
      mockCheckoutRepo.findOneBy.mockResolvedValue(null);
      await expect(
        service.refundCheckoutSession('unknown-session'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for a session that is not completed', async () => {
      mockCheckoutRepo.findOneBy.mockResolvedValue({
        id: 'sess-1',
        status: 'pending',
      });
      await expect(service.refundCheckoutSession('sess-1')).rejects.toThrow(
        'Only a completed checkout session can be refunded.',
      );
    });

    it('calls the provider refund and marks the session refunded', async () => {
      mockCheckoutRepo.findOneBy.mockResolvedValue({
        id: 'sess-1',
        status: 'completed',
        provider: 'paystack',
      });
      mockCheckoutRepo.save.mockImplementation((v) => v);

      const result = await service.refundCheckoutSession('sess-1', 50000);

      expect(mockProvider.refund).toHaveBeenCalledWith('sess-1', 50000);
      expect(result.status).toBe('refunded');
      expect(mockCheckoutRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'refunded' }),
      );
    });
  });

  describe('listCheckoutSessions', () => {
    it('lists sessions for the given tenant, newest first', async () => {
      mockCheckoutRepo.find.mockResolvedValue([{ id: 'sess-1' }]);
      const result = await service.listCheckoutSessions('tenant-1');
      expect(mockCheckoutRepo.find).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        order: { createdAt: 'DESC' },
      });
      expect(result).toEqual([{ id: 'sess-1' }]);
    });
  });
});
