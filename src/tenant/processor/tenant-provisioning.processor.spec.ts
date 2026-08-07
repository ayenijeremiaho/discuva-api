import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Job } from 'bull';
import {
  TenantProvisioningJobData,
  TenantProvisioningProcessor,
} from './tenant-provisioning.processor';
import { TenantProvisioningService } from '../service/tenant-provisioning.service';
import { BranchInviteService } from '../../branch/service/branch-invite.service';
import { Tenant } from '../entity/tenant.entity';
import { TenantOnboardingStatus } from '../enum/tenant-onboarding-status.enum';
import { TenantOnboardingActorType } from '../enum/tenant-onboarding-actor-type.enum';

const mockTenantRepo = { update: jest.fn() };
const mockProvisioningService = {
  provision: jest.fn(),
  recordEvent: jest.fn(),
};
const mockBranchInviteService = { markAccepted: jest.fn() };

const baseJobData: TenantProvisioningJobData = {
  tenantId: 'tenant-1',
  subdomain: 'test-church',
  churchName: 'Test Church',
  adminFirstname: 'Ada',
  adminLastname: 'Min',
  adminEmail: 'admin@test-church.org',
  actorType: TenantOnboardingActorType.SELF_SERVE,
};

const makeJob = (
  data: Partial<TenantProvisioningJobData> = {},
  attemptsMade = 1,
  attempts = 3,
): Job<TenantProvisioningJobData> =>
  ({
    data: { ...baseJobData, ...data },
    attemptsMade,
    opts: { attempts },
  }) as Job<TenantProvisioningJobData>;

describe('TenantProvisioningProcessor', () => {
  let processor: TenantProvisioningProcessor;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockProvisioningService.provision.mockResolvedValue({
      id: 'tenant-1',
      subdomain: 'test-church',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantProvisioningProcessor,
        { provide: getRepositoryToken(Tenant), useValue: mockTenantRepo },
        {
          provide: TenantProvisioningService,
          useValue: mockProvisioningService,
        },
        { provide: BranchInviteService, useValue: mockBranchInviteService },
      ],
    }).compile();
    processor = module.get(TenantProvisioningProcessor);
  });

  describe('handle', () => {
    it('marks the tenant PROVISIONING, records the started event, then provisions', async () => {
      await processor.handle(makeJob());

      expect(mockTenantRepo.update).toHaveBeenCalledWith('tenant-1', {
        onboardingStatus: TenantOnboardingStatus.PROVISIONING,
      });
      expect(mockProvisioningService.recordEvent).toHaveBeenCalledWith(
        'tenant-1',
        'PROVISIONING_STARTED',
        TenantOnboardingActorType.SELF_SERVE,
        { actorId: undefined },
      );
      expect(mockProvisioningService.provision).toHaveBeenCalledWith(
        expect.objectContaining({ subdomain: 'test-church' }),
      );
    });

    it('marks the tenant ACTIVE and records the completed event on success', async () => {
      await processor.handle(makeJob());

      expect(mockTenantRepo.update).toHaveBeenCalledWith('tenant-1', {
        onboardingStatus: TenantOnboardingStatus.ACTIVE,
      });
      expect(mockProvisioningService.recordEvent).toHaveBeenCalledWith(
        'tenant-1',
        'PROVISIONING_COMPLETED',
        TenantOnboardingActorType.SELF_SERVE,
        { actorId: undefined },
      );
    });

    it('consumes the branch invite after success when a token was carried on the job', async () => {
      await processor.handle(makeJob({ branchInviteToken: 'the-token' }));

      expect(mockBranchInviteService.markAccepted).toHaveBeenCalledWith(
        'the-token',
        'tenant-1',
      );
    });

    it('does not touch the branch invite service when no token is present', async () => {
      await processor.handle(makeJob());

      expect(mockBranchInviteService.markAccepted).not.toHaveBeenCalled();
    });

    it('does not swallow job data fields not part of ProvisionTenantParams (tenantId/actorType/branchInviteToken)', async () => {
      await processor.handle(
        makeJob({
          actorId: 'admin-1',
          actorType: TenantOnboardingActorType.PLATFORM_ADMIN,
        }),
      );

      const provisionArg = mockProvisioningService.provision.mock.calls[0][0];
      expect(provisionArg.tenantId).toBeUndefined();
      expect(provisionArg.actorType).toBeUndefined();
      expect(provisionArg.branchInviteToken).toBeUndefined();
    });
  });

  describe('onFailed', () => {
    it('does not mark the tenant FAILED while attempts remain', async () => {
      await processor.onFailed(makeJob({}, 1, 3), new Error('transient'));

      expect(mockTenantRepo.update).not.toHaveBeenCalled();
      expect(mockProvisioningService.recordEvent).not.toHaveBeenCalled();
    });

    it('marks the tenant FAILED and records the failed event once attempts are exhausted', async () => {
      await processor.onFailed(
        makeJob({}, 3, 3),
        new Error('CREATE SCHEMA failed'),
      );

      expect(mockTenantRepo.update).toHaveBeenCalledWith('tenant-1', {
        onboardingStatus: TenantOnboardingStatus.FAILED,
      });
      expect(mockProvisioningService.recordEvent).toHaveBeenCalledWith(
        'tenant-1',
        'PROVISIONING_FAILED',
        TenantOnboardingActorType.SELF_SERVE,
        {
          actorId: undefined,
          metadata: { error: 'CREATE SCHEMA failed' },
        },
      );
    });
  });
});
