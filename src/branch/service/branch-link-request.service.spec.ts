import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { BranchLinkRequestService } from './branch-link-request.service';
import {
  BranchLinkRequestStatus,
  TenantBranchLinkRequest,
} from '../entity/tenant-branch-link-request.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { Subscription } from '../../billing/entity/subscription.entity';
import { SubscriptionStatus } from '../../billing/enum/subscription-status.enum';
import { EmailQueueService } from '../../utility/service/email-queue.service';
import { CacheService } from '../../utility/service/cache.service';

jest.mock('../../tenant/utility/run-in-tenant-context', () => ({
  runInTenantContext: jest.fn((_cls, _txHost, _envelope, fn) => fn()),
}));

const mockLinkRequestRepo = {
  save: jest.fn(),
  create: jest.fn((v) => v),
  find: jest.fn(),
  findOneBy: jest.fn(),
};
const mockTenantRepo = {
  findOneByOrFail: jest.fn(),
  findOneBy: jest.fn(),
  findBy: jest.fn(),
  save: jest.fn((v) => v),
};
const mockSubscriptionRepo = { findOneBy: jest.fn(), save: jest.fn() };
const mockCls = { get: jest.fn().mockReturnValue('parent-tenant-1') };
const mockEmailQueueService = { queueEmail: jest.fn() };
const mockCacheService = { del: jest.fn() };
const mockManagerTx = { findOne: jest.fn() };
const mockTxHost = { tx: mockManagerTx };

describe('BranchLinkRequestService', () => {
  let service: BranchLinkRequestService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCls.get.mockReturnValue('parent-tenant-1');
    mockLinkRequestRepo.create.mockImplementation((v) => v);
    mockTenantRepo.findOneByOrFail.mockResolvedValue({
      id: 'parent-tenant-1',
      name: 'Parent Church',
      schemaName: 'parent_schema',
    });
    mockManagerTx.findOne.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BranchLinkRequestService,
        { provide: ClsService, useValue: mockCls },
        { provide: TransactionHost, useValue: mockTxHost },
        { provide: EmailQueueService, useValue: mockEmailQueueService },
        { provide: CacheService, useValue: mockCacheService },
        {
          provide: getRepositoryToken(TenantBranchLinkRequest),
          useValue: mockLinkRequestRepo,
        },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        {
          provide: getRepositoryToken(Subscription),
          useValue: mockSubscriptionRepo,
        },
      ],
    }).compile();
    service = module.get(BranchLinkRequestService);
  });

  describe('tenant context guard', () => {
    it('throws when called with no tenant in CLS', async () => {
      mockCls.get.mockReturnValue(undefined);
      await expect(service.listOutgoing()).rejects.toThrow(ForbiddenException);
    });
  });

  describe('createLinkRequest', () => {
    it('throws NotFoundException when the target subdomain does not exist', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue(null);
      await expect(service.createLinkRequest('nosuchchurch')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when linking to itself', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue({
        id: 'parent-tenant-1',
        parentTenantId: null,
      });
      await expect(service.createLinkRequest('selfchurch')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when the target already has a parent', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue({
        id: 'target-1',
        parentTenantId: 'some-other-parent',
      });
      await expect(service.createLinkRequest('branchchurch')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when a pending request already exists', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue({
        id: 'target-1',
        name: 'Target Church',
        schemaName: 'target_schema',
        parentTenantId: null,
      });
      mockLinkRequestRepo.findOneBy.mockResolvedValue({
        id: 'existing-request',
        status: BranchLinkRequestStatus.PENDING,
      });
      await expect(service.createLinkRequest('targetchurch')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('creates a pending link request and notifies the target admin', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue({
        id: 'target-1',
        name: 'Target Church',
        schemaName: 'target_schema',
        parentTenantId: null,
      });
      mockLinkRequestRepo.findOneBy.mockResolvedValue(null);
      mockLinkRequestRepo.save.mockImplementation((v) => v);
      mockManagerTx.findOne.mockResolvedValue({
        member: { email: 'target-admin@example.com' },
      });

      const request = await service.createLinkRequest('targetchurch', true);

      expect(request.parentTenantId).toBe('parent-tenant-1');
      expect(request.targetTenantId).toBe('target-1');
      expect(request.status).toBe(BranchLinkRequestStatus.PENDING);
      expect(request.sponsorPlan).toBe(true);
      expect(mockEmailQueueService.queueEmail).toHaveBeenCalledWith(
        'target-admin@example.com',
        expect.stringContaining('Parent Church'),
        expect.stringContaining('sponsored'),
      );
    });
  });

  describe('listOutgoing', () => {
    it('returns an empty array without querying tenants when there are no requests', async () => {
      mockLinkRequestRepo.find.mockResolvedValue([]);
      const result = await service.listOutgoing();
      expect(result).toEqual([]);
      expect(mockTenantRepo.findBy).not.toHaveBeenCalled();
    });

    it('enriches requests with parent/target tenant names and subdomain', async () => {
      mockLinkRequestRepo.find.mockResolvedValue([
        {
          id: 'req-1',
          parentTenantId: 'parent-tenant-1',
          targetTenantId: 'target-1',
          status: BranchLinkRequestStatus.PENDING,
          sponsorPlan: true,
          respondedAt: null,
          createdAt: new Date('2026-01-01'),
        },
      ]);
      mockTenantRepo.findBy.mockResolvedValue([
        { id: 'parent-tenant-1', name: 'Parent Church', subdomain: 'parent' },
        { id: 'target-1', name: 'Target Church', subdomain: 'targetchurch' },
      ]);

      const result = await service.listOutgoing();

      expect(result).toEqual([
        expect.objectContaining({
          id: 'req-1',
          parentTenantName: 'Parent Church',
          targetTenantName: 'Target Church',
          targetTenantSubdomain: 'targetchurch',
        }),
      ]);
    });
  });

  describe('revokeLinkRequest', () => {
    it('throws NotFoundException for a request belonging to a different tenant', async () => {
      mockLinkRequestRepo.findOneBy.mockResolvedValue(null);
      await expect(service.revokeLinkRequest('req-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when the request is not pending', async () => {
      mockLinkRequestRepo.findOneBy.mockResolvedValue({
        id: 'req-1',
        status: BranchLinkRequestStatus.ACCEPTED,
      });
      await expect(service.revokeLinkRequest('req-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('revokes a pending request', async () => {
      mockLinkRequestRepo.findOneBy.mockResolvedValue({
        id: 'req-1',
        status: BranchLinkRequestStatus.PENDING,
      });
      mockLinkRequestRepo.save.mockImplementation((v) => v);
      const result = await service.revokeLinkRequest('req-1');
      expect(result.status).toBe(BranchLinkRequestStatus.REVOKED);
    });
  });

  describe('acceptLinkRequest', () => {
    beforeEach(() => {
      mockCls.get.mockReturnValue('target-tenant-1');
    });

    it('throws NotFoundException when no matching pending request exists for this tenant', async () => {
      mockLinkRequestRepo.findOneBy.mockResolvedValue(null);
      await expect(service.acceptLinkRequest('req-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when the request is not pending', async () => {
      mockLinkRequestRepo.findOneBy.mockResolvedValue({
        id: 'req-1',
        status: BranchLinkRequestStatus.DECLINED,
      });
      await expect(service.acceptLinkRequest('req-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when this tenant already has a parent', async () => {
      mockLinkRequestRepo.findOneBy.mockResolvedValue({
        id: 'req-1',
        status: BranchLinkRequestStatus.PENDING,
        parentTenantId: 'parent-tenant-1',
        sponsorPlan: false,
      });
      mockTenantRepo.findOneByOrFail.mockResolvedValue({
        id: 'target-tenant-1',
        parentTenantId: 'already-a-parent',
      });
      await expect(service.acceptLinkRequest('req-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('links the target under the parent without sponsorship when sponsorPlan is false', async () => {
      mockLinkRequestRepo.findOneBy.mockResolvedValue({
        id: 'req-1',
        status: BranchLinkRequestStatus.PENDING,
        parentTenantId: 'parent-tenant-1',
        sponsorPlan: false,
      });
      mockTenantRepo.findOneByOrFail.mockResolvedValue({
        id: 'target-tenant-1',
        name: 'Target Church',
        schemaName: 'target_schema',
        parentTenantId: null,
      });
      mockLinkRequestRepo.save.mockImplementation((v) => v);
      mockTenantRepo.save = jest.fn().mockImplementation((v) => v);
      mockTenantRepo.findOneBy.mockResolvedValue({
        id: 'parent-tenant-1',
        name: 'Parent Church',
        schemaName: 'parent_schema',
      });
      mockManagerTx.findOne.mockResolvedValue(null);

      const result = await service.acceptLinkRequest('req-1');

      expect(result.status).toBe(BranchLinkRequestStatus.ACCEPTED);
      expect(mockTenantRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ parentTenantId: 'parent-tenant-1' }),
      );
      expect(mockSubscriptionRepo.save).not.toHaveBeenCalled();
    });

    it('applies sponsorship when sponsorPlan is true and the parent is on a paid plan', async () => {
      mockLinkRequestRepo.findOneBy.mockResolvedValue({
        id: 'req-1',
        status: BranchLinkRequestStatus.PENDING,
        parentTenantId: 'parent-tenant-1',
        sponsorPlan: true,
      });
      mockTenantRepo.findOneByOrFail.mockResolvedValue({
        id: 'target-tenant-1',
        name: 'Target Church',
        schemaName: 'target_schema',
        parentTenantId: null,
      });
      mockLinkRequestRepo.save.mockImplementation((v) => v);
      mockTenantRepo.save = jest.fn().mockImplementation((v) => v);
      mockTenantRepo.findOneBy.mockResolvedValue({
        id: 'parent-tenant-1',
        name: 'Parent Church',
        schemaName: 'parent_schema',
      });
      mockSubscriptionRepo.findOneBy
        .mockResolvedValueOnce({ tenantId: 'parent-tenant-1', planId: 'pro' })
        .mockResolvedValueOnce({
          tenantId: 'target-tenant-1',
          planId: 'free',
        });
      mockSubscriptionRepo.save.mockImplementation((v) => v);

      await service.acceptLinkRequest('req-1');

      expect(mockSubscriptionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          planId: 'pro',
          status: SubscriptionStatus.ACTIVE,
          sponsoredByTenantId: 'parent-tenant-1',
        }),
      );
      expect(mockCacheService.del).toHaveBeenCalledWith(
        'plan-features:target-tenant-1',
      );
    });

    it('skips sponsorship when the parent is on Free even if sponsorPlan is true', async () => {
      mockLinkRequestRepo.findOneBy.mockResolvedValue({
        id: 'req-1',
        status: BranchLinkRequestStatus.PENDING,
        parentTenantId: 'parent-tenant-1',
        sponsorPlan: true,
      });
      mockTenantRepo.findOneByOrFail.mockResolvedValue({
        id: 'target-tenant-1',
        name: 'Target Church',
        schemaName: 'target_schema',
        parentTenantId: null,
      });
      mockLinkRequestRepo.save.mockImplementation((v) => v);
      mockTenantRepo.save = jest.fn().mockImplementation((v) => v);
      mockTenantRepo.findOneBy.mockResolvedValue({
        id: 'parent-tenant-1',
        name: 'Parent Church',
        schemaName: 'parent_schema',
      });
      mockSubscriptionRepo.findOneBy.mockResolvedValue({
        tenantId: 'parent-tenant-1',
        planId: 'free',
      });

      await service.acceptLinkRequest('req-1');

      expect(mockSubscriptionRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('declineLinkRequest', () => {
    beforeEach(() => {
      mockCls.get.mockReturnValue('target-tenant-1');
    });

    it('throws NotFoundException when no matching request exists', async () => {
      mockLinkRequestRepo.findOneBy.mockResolvedValue(null);
      await expect(service.declineLinkRequest('req-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when the request is not pending', async () => {
      mockLinkRequestRepo.findOneBy.mockResolvedValue({
        id: 'req-1',
        status: BranchLinkRequestStatus.ACCEPTED,
      });
      await expect(service.declineLinkRequest('req-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('declines a pending request', async () => {
      mockLinkRequestRepo.findOneBy.mockResolvedValue({
        id: 'req-1',
        status: BranchLinkRequestStatus.PENDING,
        parentTenantId: 'parent-tenant-1',
        targetTenantId: 'target-tenant-1',
      });
      mockLinkRequestRepo.save.mockImplementation((v) => v);
      mockTenantRepo.findOneBy.mockResolvedValue({
        id: 'parent-tenant-1',
        name: 'Parent Church',
        schemaName: 'parent_schema',
      });

      const result = await service.declineLinkRequest('req-1');
      expect(result.status).toBe(BranchLinkRequestStatus.DECLINED);
    });
  });
});
