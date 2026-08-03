import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { BranchInviteService } from './branch-invite.service';
import {
  BranchInviteStatus,
  TenantBranchInvite,
} from '../entity/tenant-branch-invite.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { Subscription } from '../../billing/entity/subscription.entity';
import { EmailQueueService } from '../../utility/service/email-queue.service';

const mockInviteRepo = {
  save: jest.fn(),
  create: jest.fn((v) => v),
  find: jest.fn(),
  findOneBy: jest.fn(),
  update: jest.fn(),
};

const mockTenantRepo = { findOneByOrFail: jest.fn() };
const mockSubscriptionRepo = { findOneBy: jest.fn() };

const mockCls = { get: jest.fn().mockReturnValue('parent-tenant-1') };
const mockEmailQueueService = { queueEmail: jest.fn() };

describe('BranchInviteService', () => {
  let service: BranchInviteService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCls.get.mockReturnValue('parent-tenant-1');
    mockInviteRepo.create.mockImplementation((v) => v);
    mockTenantRepo.findOneByOrFail.mockResolvedValue({
      id: 'parent-tenant-1',
      name: 'Parent Church',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BranchInviteService,
        { provide: ClsService, useValue: mockCls },
        { provide: EmailQueueService, useValue: mockEmailQueueService },
        {
          provide: getRepositoryToken(TenantBranchInvite),
          useValue: mockInviteRepo,
        },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        {
          provide: getRepositoryToken(Subscription),
          useValue: mockSubscriptionRepo,
        },
      ],
    }).compile();
    service = module.get(BranchInviteService);
  });

  describe('tenant context guard', () => {
    it('throws when called with no tenant in CLS', async () => {
      mockCls.get.mockReturnValue(undefined);
      await expect(service.createInvite('branch@example.com')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('createInvite', () => {
    it('saves a pending invite with a generated token and queues an email', async () => {
      mockInviteRepo.save.mockImplementation((v) => v);

      const invite = await service.createInvite('branch@example.com');

      expect(invite.parentTenantId).toBe('parent-tenant-1');
      expect(invite.email).toBe('branch@example.com');
      expect(invite.status).toBe(BranchInviteStatus.PENDING);
      expect(invite.token).toHaveLength(64); // 32 bytes hex-encoded
      expect(mockEmailQueueService.queueEmail).toHaveBeenCalledWith(
        'branch@example.com',
        expect.stringContaining('Parent Church'),
        expect.stringContaining(invite.token),
      );
    });

    it('stores sponsorPlan and mentions sponsorship in the invite email when true', async () => {
      mockInviteRepo.save.mockImplementation((v) => v);

      const invite = await service.createInvite('branch@example.com', true);

      expect(invite.sponsorPlan).toBe(true);
      expect(mockEmailQueueService.queueEmail).toHaveBeenCalledWith(
        'branch@example.com',
        expect.any(String),
        expect.stringContaining('sponsored'),
      );
    });

    it('defaults sponsorPlan to false when omitted', async () => {
      mockInviteRepo.save.mockImplementation((v) => v);
      const invite = await service.createInvite('branch@example.com');
      expect(invite.sponsorPlan).toBe(false);
    });
  });

  describe('revokeInvite', () => {
    it('throws NotFoundException for an invite belonging to a different tenant', async () => {
      mockInviteRepo.findOneBy.mockResolvedValue(null);
      await expect(service.revokeInvite('invite-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when the invite is not pending', async () => {
      mockInviteRepo.findOneBy.mockResolvedValue({
        id: 'invite-1',
        status: BranchInviteStatus.ACCEPTED,
      });
      await expect(service.revokeInvite('invite-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('revokes a pending invite', async () => {
      mockInviteRepo.findOneBy.mockResolvedValue({
        id: 'invite-1',
        status: BranchInviteStatus.PENDING,
      });
      mockInviteRepo.save.mockImplementation((v) => v);

      const result = await service.revokeInvite('invite-1');
      expect(result.status).toBe(BranchInviteStatus.REVOKED);
    });
  });

  describe('resolveInvite', () => {
    it('throws BadRequestException for an unknown token', async () => {
      mockInviteRepo.findOneBy.mockResolvedValue(null);
      await expect(service.resolveInvite('bad-token')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException for an already-accepted invite', async () => {
      mockInviteRepo.findOneBy.mockResolvedValue({
        status: BranchInviteStatus.ACCEPTED,
      });
      await expect(service.resolveInvite('token')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException for an expired invite', async () => {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() - 1);
      mockInviteRepo.findOneBy.mockResolvedValue({
        status: BranchInviteStatus.PENDING,
        expiresAt,
        parentTenantId: 'parent-tenant-1',
      });
      await expect(service.resolveInvite('token')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns a null sponsoredPlanId for a non-sponsored invite', async () => {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 1);
      mockInviteRepo.findOneBy.mockResolvedValue({
        status: BranchInviteStatus.PENDING,
        expiresAt,
        parentTenantId: 'parent-tenant-1',
        sponsorPlan: false,
      });
      const result = await service.resolveInvite('token');
      expect(result).toEqual({
        parentTenantId: 'parent-tenant-1',
        sponsoredPlanId: null,
      });
      expect(mockSubscriptionRepo.findOneBy).not.toHaveBeenCalled();
    });

    it('resolves sponsoredPlanId from the parent subscription when sponsorPlan is true and the parent is paid', async () => {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 1);
      mockInviteRepo.findOneBy.mockResolvedValue({
        status: BranchInviteStatus.PENDING,
        expiresAt,
        parentTenantId: 'parent-tenant-1',
        sponsorPlan: true,
      });
      mockSubscriptionRepo.findOneBy.mockResolvedValue({
        tenantId: 'parent-tenant-1',
        planId: 'pro',
      });

      const result = await service.resolveInvite('token');
      expect(result).toEqual({
        parentTenantId: 'parent-tenant-1',
        sponsoredPlanId: 'pro',
      });
    });

    it('falls back to null sponsoredPlanId when sponsorPlan is true but the parent is on Free', async () => {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 1);
      mockInviteRepo.findOneBy.mockResolvedValue({
        status: BranchInviteStatus.PENDING,
        expiresAt,
        parentTenantId: 'parent-tenant-1',
        sponsorPlan: true,
      });
      mockSubscriptionRepo.findOneBy.mockResolvedValue({
        tenantId: 'parent-tenant-1',
        planId: 'free',
      });

      const result = await service.resolveInvite('token');
      expect(result.sponsoredPlanId).toBeNull();
    });
  });

  describe('markAccepted', () => {
    it('marks the invite accepted with the new tenant id', async () => {
      await service.markAccepted('token', 'new-tenant-1');
      expect(mockInviteRepo.update).toHaveBeenCalledWith(
        { token: 'token' },
        {
          status: BranchInviteStatus.ACCEPTED,
          acceptedTenantId: 'new-tenant-1',
        },
      );
    });
  });
});
