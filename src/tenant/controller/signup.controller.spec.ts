import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { SignupController } from './signup.controller';
import { TenantProvisioningService } from '../service/tenant-provisioning.service';
import { BranchInviteService } from '../../branch/service/branch-invite.service';
import { Tenant } from '../entity/tenant.entity';
import { TenantOnboardingStatus } from '../enum/tenant-onboarding-status.enum';
import { TenantOnboardingActorType } from '../enum/tenant-onboarding-actor-type.enum';
import { TENANT_PROVISIONING_QUEUE } from '../processor/tenant-provisioning.processor';

const mockProvisioningService = {
  ensurePendingTenant: jest.fn(),
  recordEvent: jest.fn(),
};
const mockBranchInviteService = {
  resolveInvite: jest.fn(),
  markAccepted: jest.fn(),
};
const mockQueue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
const mockTenantRepo = { findOneBy: jest.fn() };

const baseDto = {
  churchName: 'Test Church',
  subdomain: 'test-church',
  adminFirstname: 'Jane',
  adminLastname: 'Doe',
  adminEmail: 'jane@example.com',
};

const pendingTenant = {
  id: 'tenant-1',
  subdomain: 'test-church',
  name: 'Test Church',
  onboardingStatus: TenantOnboardingStatus.PENDING,
};

describe('SignupController', () => {
  let controller: SignupController;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockProvisioningService.ensurePendingTenant.mockResolvedValue(
      pendingTenant,
    );

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SignupController],
      providers: [
        {
          provide: TenantProvisioningService,
          useValue: mockProvisioningService,
        },
        { provide: BranchInviteService, useValue: mockBranchInviteService },
        {
          provide: getQueueToken(TENANT_PROVISIONING_QUEUE),
          useValue: mockQueue,
        },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
      ],
    }).compile();
    controller = module.get(SignupController);
  });

  describe('signup', () => {
    it('creates a pending tenant, enqueues provisioning, and returns immediately with PENDING status', async () => {
      const result = await controller.signup(baseDto);

      expect(mockBranchInviteService.resolveInvite).not.toHaveBeenCalled();
      expect(mockProvisioningService.ensurePendingTenant).toHaveBeenCalledWith(
        baseDto.subdomain,
        baseDto.churchName,
        undefined,
      );
      expect(mockProvisioningService.recordEvent).toHaveBeenCalledWith(
        'tenant-1',
        'SIGNUP_INITIATED',
        TenantOnboardingActorType.SELF_SERVE,
      );
      expect(mockQueue.add).toHaveBeenCalledWith(
        'provision',
        expect.objectContaining({
          tenantId: 'tenant-1',
          parentTenantId: undefined,
          sponsoredPlanId: undefined,
          actorType: TenantOnboardingActorType.SELF_SERVE,
        }),
      );
      expect(mockBranchInviteService.markAccepted).not.toHaveBeenCalled();
      expect(result.tenant.onboardingStatus).toBe(
        TenantOnboardingStatus.PENDING,
      );
    });

    it('resolves the invite token and enqueues provisioning with parentTenantId + the invite token', async () => {
      mockBranchInviteService.resolveInvite.mockResolvedValue({
        parentTenantId: 'parent-tenant-1',
        sponsoredPlanId: null,
      });

      await controller.signup({ ...baseDto, branchInviteToken: 'the-token' });

      expect(mockBranchInviteService.resolveInvite).toHaveBeenCalledWith(
        'the-token',
      );
      expect(mockProvisioningService.ensurePendingTenant).toHaveBeenCalledWith(
        baseDto.subdomain,
        baseDto.churchName,
        'parent-tenant-1',
      );
      expect(mockQueue.add).toHaveBeenCalledWith(
        'provision',
        expect.objectContaining({
          parentTenantId: 'parent-tenant-1',
          branchInviteToken: 'the-token',
        }),
      );
      // Consumption moves to TenantProvisioningProcessor, once provisioning
      // actually succeeds — the controller no longer awaits that.
      expect(mockBranchInviteService.markAccepted).not.toHaveBeenCalled();
    });

    it('passes sponsoredPlanId through to the enqueued job when the invite is sponsored', async () => {
      mockBranchInviteService.resolveInvite.mockResolvedValue({
        parentTenantId: 'parent-tenant-1',
        sponsoredPlanId: 'pro',
      });

      await controller.signup({ ...baseDto, branchInviteToken: 'the-token' });

      expect(mockQueue.add).toHaveBeenCalledWith(
        'provision',
        expect.objectContaining({
          parentTenantId: 'parent-tenant-1',
          sponsoredPlanId: 'pro',
        }),
      );
    });

    it('never enqueues when ensurePendingTenant itself fails (e.g. subdomain taken)', async () => {
      mockProvisioningService.ensurePendingTenant.mockRejectedValue(
        new Error('This subdomain is already in use.'),
      );

      await expect(controller.signup(baseDto)).rejects.toThrow(
        'This subdomain is already in use.',
      );
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('propagates an invalid/expired invite token as a signup failure before creating a tenant row', async () => {
      mockBranchInviteService.resolveInvite.mockRejectedValue(
        new Error('Invalid or already-used invite code.'),
      );

      await expect(
        controller.signup({ ...baseDto, branchInviteToken: 'bad-token' }),
      ).rejects.toThrow('Invalid or already-used invite code.');
      expect(
        mockProvisioningService.ensurePendingTenant,
      ).not.toHaveBeenCalled();
      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    it('returns the current onboarding status for an existing tenant', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue({
        id: 'tenant-1',
        subdomain: 'test-church',
        name: 'Test Church',
        onboardingStatus: TenantOnboardingStatus.PROVISIONING,
      });

      const result = await controller.getStatus('tenant-1');

      expect(result).toEqual({
        status: TenantOnboardingStatus.PROVISIONING,
        subdomain: 'test-church',
        name: 'Test Church',
      });
    });

    it('throws NotFoundException for an unknown tenant id', async () => {
      mockTenantRepo.findOneBy.mockResolvedValue(null);

      await expect(controller.getStatus('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
