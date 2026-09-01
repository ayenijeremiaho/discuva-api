import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { GivingCheckoutService } from './giving-checkout.service';
import { GivingProviderRegistryService } from './giving-provider-registry.service';
import { GivingProvider } from '../entity/giving-provider.entity';
import { TenantGivingProviderConfig } from '../entity/tenant-giving-provider-config.entity';
import {
  GivingCheckoutSession,
  GivingCheckoutStatus,
} from '../entity/giving-checkout-session.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { Member } from '../../member/entity/member.entity';
import { TitheRecord } from '../../tithe/entity/tithe-record.entity';
import { GivingOption } from '../../finance/entity/giving-option.entity';
import { Pledge } from '../../finance/entity/pledge.entity';
import { PledgeStatus, TitheSource } from '../../finance/enum/finance.enum';
import { PledgeService } from '../../finance/service/pledge.service';
import { EncryptionService } from '../../utility/service/encryption.service';
import { CacheService } from '../../utility/service/cache.service';

jest.mock('../../tenant/utility/run-in-tenant-context', () => ({
  runInTenantContext: jest.fn((_cls, _txHost, _envelope, fn) => fn()),
}));

const mockCls = { get: jest.fn().mockReturnValue('tenant-1') };
const mockCacheService = {
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(1),
  getOrSet: jest.fn(),
};
const mockEncryptionService = { decryptFields: jest.fn((v) => v) };
const mockGivingProvider = {
  providerName: 'paystack',
  createCheckoutSession: jest.fn(),
  verifyAndParseWebhook: jest.fn(),
};
const mockRegistry = { get: jest.fn().mockReturnValue(mockGivingProvider) };
const mockProviderRepo = { findOneBy: jest.fn() };
const mockConfigRepo = {
  createQueryBuilder: jest.fn(),
};
const mockCheckoutRepo = {
  create: jest.fn((v) => v),
  save: jest.fn(),
  update: jest.fn(),
};
const mockTenantRepo = { findOneByOrFail: jest.fn() };
const mockMemberRepo = { findOneByOrFail: jest.fn() };
const mockGivingOptionRepo = { exists: jest.fn() };
const mockPledgeRepo = { findOne: jest.fn() };
const mockPledgeService = { recordConfirmedContribution: jest.fn() };

const mockManagerTx = { create: jest.fn((_e, v) => v), save: jest.fn() };
const mockTxHost = { tx: mockManagerTx };

const mockManager = {
  findOne: jest.fn(),
  save: jest.fn(),
};
const mockDataSource = {
  transaction: jest.fn((cb) => cb(mockManager)),
};

function mockConfigQB(result: any) {
  const qb = {
    innerJoin: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(result),
  };
  mockConfigRepo.createQueryBuilder.mockReturnValue(qb);
  return qb;
}

describe('GivingCheckoutService', () => {
  let service: GivingCheckoutService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCls.get.mockReturnValue('tenant-1');
    mockRegistry.get.mockReturnValue(mockGivingProvider);
    mockCacheService.getOrSet.mockImplementation(async (_key, fetcher) => {
      const result = await fetcher();
      return result;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GivingCheckoutService,
        { provide: ClsService, useValue: mockCls },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'NGN') } },
        { provide: EncryptionService, useValue: mockEncryptionService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: GivingProviderRegistryService, useValue: mockRegistry },
        { provide: TransactionHost, useValue: mockTxHost },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        {
          provide: getRepositoryToken(GivingProvider),
          useValue: mockProviderRepo,
        },
        {
          provide: getRepositoryToken(TenantGivingProviderConfig),
          useValue: mockConfigRepo,
        },
        {
          provide: getRepositoryToken(GivingCheckoutSession),
          useValue: mockCheckoutRepo,
        },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        { provide: getRepositoryToken(Member), useValue: mockMemberRepo },
        {
          provide: getRepositoryToken(GivingOption),
          useValue: mockGivingOptionRepo,
        },
        { provide: getRepositoryToken(Pledge), useValue: mockPledgeRepo },
        { provide: PledgeService, useValue: mockPledgeService },
      ],
    }).compile();
    service = module.get(GivingCheckoutService);
  });

  describe('getActiveProvider', () => {
    it('returns null when the tenant has no active giving provider', async () => {
      mockConfigQB(null);
      const result = await service.getActiveProvider();
      expect(result).toBeNull();
    });

    it('returns the active provider id and name', async () => {
      mockConfigQB({
        providerId: 'stripe',
        credentialsEncrypted: { secretKey: 'x' },
      });
      mockProviderRepo.findOneBy.mockResolvedValue({
        id: 'stripe',
        name: 'Stripe',
      });

      const result = await service.getActiveProvider();

      expect(result).toEqual({ providerId: 'stripe', providerName: 'Stripe' });
    });
  });

  describe('initiateCheckout', () => {
    it('throws ForbiddenException with GIVING_PROVIDER_NOT_CONFIGURED when nothing is active', async () => {
      mockConfigQB(null);

      await expect(
        service.initiateCheckout('member-1', {
          amountCents: 500000,
          successUrl: 'https://a',
          cancelUrl: 'https://b',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('also filters on the platform catalog entry being active, not just the tenant config — a platform-deactivated provider blocks new checkout', async () => {
      const qb = mockConfigQB(null);
      await expect(
        service.initiateCheckout('member-1', {
          amountCents: 500000,
          successUrl: 'https://a',
          cancelUrl: 'https://b',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(qb.innerJoin).toHaveBeenCalled();
      expect(qb.andWhere).toHaveBeenCalledWith('provider.isActive = true');
    });

    it('creates a checkout session and records a pending GivingCheckoutSession row', async () => {
      mockConfigQB({
        providerId: 'paystack',
        credentialsEncrypted: { secretKey: 'sk_1' },
      });
      mockMemberRepo.findOneByOrFail.mockResolvedValue({
        id: 'member-1',
        email: 'member@example.com',
        firstname: 'Jane',
        lastname: 'Doe',
      });
      mockGivingProvider.createCheckoutSession.mockResolvedValue({
        checkoutUrl: 'https://checkout.paystack.com/abc',
      });

      const result = await service.initiateCheckout('member-1', {
        amountCents: 500000,
        successUrl: 'https://a',
        cancelUrl: 'https://b',
      });

      expect(mockRegistry.get).toHaveBeenCalledWith('paystack');
      expect(mockGivingProvider.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          amountCents: 500000,
          currency: 'NGN',
          payerEmail: 'member@example.com',
          payerName: 'Jane Doe',
          credentials: { secretKey: 'sk_1' },
        }),
      );
      expect(mockCheckoutRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          memberId: 'member-1',
          amountCents: 500000,
          provider: 'paystack',
          status: GivingCheckoutStatus.PENDING,
        }),
      );
      expect(result.checkoutUrl).toBe('https://checkout.paystack.com/abc');
    });

    it('throws BadRequestException when both givingOptionId and pledgeId are given', async () => {
      await expect(
        service.initiateCheckout('member-1', {
          amountCents: 500000,
          givingOptionId: 'go-1',
          pledgeId: 'pledge-1',
          successUrl: 'https://a',
          cancelUrl: 'https://b',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for an inactive/unknown giving option', async () => {
      mockConfigQB({
        providerId: 'paystack',
        credentialsEncrypted: { secretKey: 'sk_1' },
      });
      mockMemberRepo.findOneByOrFail.mockResolvedValue({
        id: 'member-1',
        email: 'member@example.com',
        firstname: 'Jane',
        lastname: 'Doe',
      });
      mockGivingOptionRepo.exists.mockResolvedValue(false);

      await expect(
        service.initiateCheckout('member-1', {
          amountCents: 500000,
          givingOptionId: 'go-1',
          successUrl: 'https://a',
          cancelUrl: 'https://b',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the pledge does not belong to the member', async () => {
      mockConfigQB({
        providerId: 'paystack',
        credentialsEncrypted: { secretKey: 'sk_1' },
      });
      mockMemberRepo.findOneByOrFail.mockResolvedValue({
        id: 'member-1',
        email: 'member@example.com',
        firstname: 'Jane',
        lastname: 'Doe',
      });
      mockPledgeRepo.findOne.mockResolvedValue(null);

      await expect(
        service.initiateCheckout('member-1', {
          amountCents: 500000,
          pledgeId: 'pledge-1',
          successUrl: 'https://a',
          cancelUrl: 'https://b',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the pledge is not ACTIVE', async () => {
      mockConfigQB({
        providerId: 'paystack',
        credentialsEncrypted: { secretKey: 'sk_1' },
      });
      mockMemberRepo.findOneByOrFail.mockResolvedValue({
        id: 'member-1',
        email: 'member@example.com',
        firstname: 'Jane',
        lastname: 'Doe',
      });
      mockPledgeRepo.findOne.mockResolvedValue({
        id: 'pledge-1',
        status: PledgeStatus.COMPLETED,
      });

      await expect(
        service.initiateCheckout('member-1', {
          amountCents: 500000,
          pledgeId: 'pledge-1',
          successUrl: 'https://a',
          cancelUrl: 'https://b',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('stores givingOptionId/pledgeId on the session when valid', async () => {
      mockConfigQB({
        providerId: 'paystack',
        credentialsEncrypted: { secretKey: 'sk_1' },
      });
      mockMemberRepo.findOneByOrFail.mockResolvedValue({
        id: 'member-1',
        email: 'member@example.com',
        firstname: 'Jane',
        lastname: 'Doe',
      });
      mockGivingOptionRepo.exists.mockResolvedValue(true);
      mockGivingProvider.createCheckoutSession.mockResolvedValue({
        checkoutUrl: 'https://checkout.paystack.com/abc',
      });

      await service.initiateCheckout('member-1', {
        amountCents: 500000,
        givingOptionId: 'go-1',
        successUrl: 'https://a',
        cancelUrl: 'https://b',
      });

      expect(mockCheckoutRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ givingOptionId: 'go-1', pledgeId: null }),
      );
    });
  });

  describe('handleWebhook', () => {
    it('throws NotFoundException when no active config exists for that tenant/provider', async () => {
      mockConfigQB(null);

      await expect(
        service.handleWebhook('tenant-1', 'paystack', Buffer.from('{}'), 'sig'),
      ).rejects.toThrow(NotFoundException);
    });

    it('does NOT check the platform catalog isActive — an in-flight charge already made on the provider side must still complete even if the provider was deactivated in the meantime', async () => {
      const qb = mockConfigQB({
        providerId: 'paystack',
        credentialsEncrypted: { secretKey: 'sk_1' },
      });
      mockGivingProvider.verifyAndParseWebhook.mockReturnValue({
        type: 'charge.failed',
        providerReference: 'giving_abc',
        raw: {},
      });

      await service.handleWebhook(
        'tenant-1',
        'paystack',
        Buffer.from('{}'),
        'sig',
      );

      expect(qb.innerJoin).not.toHaveBeenCalled();
      expect(qb.andWhere).not.toHaveBeenCalledWith('provider.isActive = true');
    });

    it('marks the session failed on a non-succeeded event and does not touch tenant schema', async () => {
      mockConfigQB({
        providerId: 'paystack',
        credentialsEncrypted: { secretKey: 'sk_1' },
      });
      mockGivingProvider.verifyAndParseWebhook.mockReturnValue({
        type: 'charge.failed',
        providerReference: 'giving_abc',
        raw: {},
      });

      await service.handleWebhook(
        'tenant-1',
        'paystack',
        Buffer.from('{}'),
        'sig',
      );

      expect(mockCheckoutRepo.update).toHaveBeenCalledWith(
        { id: 'giving_abc', status: GivingCheckoutStatus.PENDING },
        { status: GivingCheckoutStatus.FAILED },
      );
      expect(mockManagerTx.save).not.toHaveBeenCalled();
    });

    it('is a safe no-op when the session reference is unknown (already processed or forged)', async () => {
      mockConfigQB({
        providerId: 'paystack',
        credentialsEncrypted: { secretKey: 'sk_1' },
      });
      mockGivingProvider.verifyAndParseWebhook.mockReturnValue({
        type: 'charge.succeeded',
        providerReference: 'unknown-ref',
        raw: {},
      });
      mockManager.findOne.mockResolvedValue(null);

      await service.handleWebhook(
        'tenant-1',
        'paystack',
        Buffer.from('{}'),
        'sig',
      );

      expect(mockManager.save).not.toHaveBeenCalled();
      expect(mockManagerTx.save).not.toHaveBeenCalled();
    });

    it('completes the session and creates a TitheRecord in the tenant own schema on success', async () => {
      mockConfigQB({
        providerId: 'paystack',
        credentialsEncrypted: { secretKey: 'sk_1' },
      });
      mockGivingProvider.verifyAndParseWebhook.mockReturnValue({
        type: 'charge.succeeded',
        providerReference: 'giving_abc',
        raw: {},
      });
      const pendingSession = {
        id: 'giving_abc',
        tenantId: 'tenant-1',
        memberId: 'member-1',
        amountCents: 500000,
        provider: 'paystack',
        status: GivingCheckoutStatus.PENDING,
      };
      mockManager.findOne.mockResolvedValue(pendingSession);
      mockTenantRepo.findOneByOrFail.mockResolvedValue({
        id: 'tenant-1',
        schemaName: 'tenant_schema_1',
      });

      await service.handleWebhook(
        'tenant-1',
        'paystack',
        Buffer.from('{}'),
        'sig',
      );

      expect(mockManager.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: GivingCheckoutStatus.COMPLETED }),
      );
      expect(mockManagerTx.create).toHaveBeenCalledWith(
        TitheRecord,
        expect.objectContaining({
          member: { id: 'member-1' },
          amount: 5000,
          source: TitheSource.PAYMENT_GATEWAY,
          externalReference: 'giving_abc',
          paymentChannel: 'paystack',
        }),
      );
      expect(mockManagerTx.save).toHaveBeenCalledWith(
        TitheRecord,
        expect.any(Object),
      );
    });

    it('sets givingOption on the TitheRecord when the session designated one', async () => {
      mockConfigQB({
        providerId: 'paystack',
        credentialsEncrypted: { secretKey: 'sk_1' },
      });
      mockGivingProvider.verifyAndParseWebhook.mockReturnValue({
        type: 'charge.succeeded',
        providerReference: 'giving_abc',
        raw: {},
      });
      mockManager.findOne.mockResolvedValue({
        id: 'giving_abc',
        tenantId: 'tenant-1',
        memberId: 'member-1',
        amountCents: 500000,
        provider: 'paystack',
        givingOptionId: 'go-1',
        status: GivingCheckoutStatus.PENDING,
      });
      mockTenantRepo.findOneByOrFail.mockResolvedValue({
        id: 'tenant-1',
        schemaName: 'tenant_schema_1',
      });

      await service.handleWebhook(
        'tenant-1',
        'paystack',
        Buffer.from('{}'),
        'sig',
      );

      expect(mockManagerTx.create).toHaveBeenCalledWith(
        TitheRecord,
        expect.objectContaining({ givingOption: { id: 'go-1' } }),
      );
    });

    it('records a CONFIRMED PledgeContribution instead of a TitheRecord when the session designated a pledge', async () => {
      mockConfigQB({
        providerId: 'paystack',
        credentialsEncrypted: { secretKey: 'sk_1' },
      });
      mockGivingProvider.verifyAndParseWebhook.mockReturnValue({
        type: 'charge.succeeded',
        providerReference: 'giving_abc',
        raw: {},
      });
      mockManager.findOne.mockResolvedValue({
        id: 'giving_abc',
        tenantId: 'tenant-1',
        memberId: 'member-1',
        amountCents: 500000,
        provider: 'paystack',
        pledgeId: 'pledge-1',
        status: GivingCheckoutStatus.PENDING,
      });
      mockTenantRepo.findOneByOrFail.mockResolvedValue({
        id: 'tenant-1',
        schemaName: 'tenant_schema_1',
      });

      await service.handleWebhook(
        'tenant-1',
        'paystack',
        Buffer.from('{}'),
        'sig',
      );

      expect(
        mockPledgeService.recordConfirmedContribution,
      ).toHaveBeenCalledWith('member-1', 'pledge-1', 5000, 'giving_abc');
      expect(mockManagerTx.create).not.toHaveBeenCalled();
      expect(mockManagerTx.save).not.toHaveBeenCalled();
    });
  });
});
