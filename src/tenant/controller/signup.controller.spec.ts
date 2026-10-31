import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { SignupController } from './signup.controller';
import { TenantProvisioningService } from '../service/tenant-provisioning.service';
import { BranchInviteService } from '../../branch/service/branch-invite.service';
import { Tenant } from '../entity/tenant.entity';
import { TenantOnboardingStatus } from '../enum/tenant-onboarding-status.enum';
import { TenantOnboardingActorType } from '../enum/tenant-onboarding-actor-type.enum';
import { ChurchRequestService } from '../service/church-request.service';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';

const mockProvisioningService = {
  ensurePendingTenant: jest.fn(),
  checkSubdomain: jest.fn(),
  recordEvent: jest.fn(),
  enqueueProvisioning: jest.fn(),
  holdForApproval: jest.fn(),
};
const mockBranchInviteService = {
  resolveInvite: jest.fn(),
  markAccepted: jest.fn(),
};
const mockSettings = {
  getRequestReviewHours: jest.fn().mockResolvedValue(12),
};
const mockChurchRequests = {
  submit: jest.fn(),
  confirm: jest.fn(),
  resendConfirmations: jest.fn(),
};
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
        { provide: ChurchRequestService, useValue: mockChurchRequests },
        { provide: PlatformSettingsService, useValue: mockSettings },
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
      ],
    }).compile();
    controller = module.get(SignupController);
  });

  describe('signup', () => {
    it('starts email confirmation for a normal signup, without provisioning', async () => {
      const result = await controller.signup(baseDto);

      expect(mockBranchInviteService.resolveInvite).not.toHaveBeenCalled();
      expect(mockProvisioningService.ensurePendingTenant).toHaveBeenCalledWith(
        baseDto.subdomain,
        baseDto.churchName,
        undefined,
      );
      expect(mockChurchRequests.submit).toHaveBeenCalledWith(
        pendingTenant,
        baseDto,
      );
      expect(
        mockProvisioningService.enqueueProvisioning,
      ).not.toHaveBeenCalled();
      expect(result.tenant.onboardingStatus).toBe(
        TenantOnboardingStatus.AWAITING_CONFIRMATION,
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
      expect(mockProvisioningService.enqueueProvisioning).toHaveBeenCalledWith(
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

      expect(mockProvisioningService.enqueueProvisioning).toHaveBeenCalledWith(
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
      expect(
        mockProvisioningService.enqueueProvisioning,
      ).not.toHaveBeenCalled();
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
      expect(
        mockProvisioningService.enqueueProvisioning,
      ).not.toHaveBeenCalled();
    });

    it('sends a branch invite straight to provisioning, as a parent church vetted it', async () => {
      mockBranchInviteService.resolveInvite.mockResolvedValue({
        parentTenantId: 'parent-tenant-1',
        sponsoredPlanId: null,
      });

      await controller.signup({ ...baseDto, branchInviteToken: 'the-token' });

      expect(mockChurchRequests.submit).not.toHaveBeenCalled();
      expect(mockProvisioningService.enqueueProvisioning).toHaveBeenCalled();
    });
  });

  it('checks an address, treating a missing one as empty', async () => {
    mockProvisioningService.checkSubdomain.mockResolvedValue({
      available: true,
    });
    await controller.checkSubdomain(undefined as unknown as string);
    expect(mockProvisioningService.checkSubdomain).toHaveBeenCalledWith('');
  });

  it('shares the promised review time', async () => {
    await expect(controller.settings()).resolves.toEqual({ reviewHours: 12 });
  });

  it('confirm passes the token through', async () => {
    mockChurchRequests.confirm.mockResolvedValue({ status: 'PENDING' });
    await controller.confirm({ token: 't' });
    expect(mockChurchRequests.confirm).toHaveBeenCalledWith('t');
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
