import { Logger } from '@nestjs/common';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../entity/tenant.entity';
import { TenantOnboardingStatus } from '../enum/tenant-onboarding-status.enum';
import { TenantOnboardingActorType } from '../enum/tenant-onboarding-actor-type.enum';
import {
  ProvisionTenantParams,
  TenantProvisioningService,
} from '../service/tenant-provisioning.service';
import { BranchInviteService } from '../../branch/service/branch-invite.service';

export const TENANT_PROVISIONING_QUEUE = 'tenant-provisioning';
export const TENANT_PROVISIONING_JOB = 'provision';

export interface TenantProvisioningJobData extends ProvisionTenantParams {
  tenantId: string;
  actorType: TenantOnboardingActorType;
  actorId?: string;
  // Signup-path only — consumed here (not the controller) since the
  // controller no longer awaits provisioning to completion.
  branchInviteToken?: string;
}

@Processor(TENANT_PROVISIONING_QUEUE)
export class TenantProvisioningProcessor {
  private readonly logger = new Logger(TenantProvisioningProcessor.name);

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly provisioningService: TenantProvisioningService,
    private readonly branchInviteService: BranchInviteService,
  ) {}

  @Process(TENANT_PROVISIONING_JOB)
  async handle(job: Job<TenantProvisioningJobData>): Promise<void> {
    const { tenantId, branchInviteToken, actorType, actorId, ...params } =
      job.data;

    await this.tenantRepo.update(tenantId, {
      onboardingStatus: TenantOnboardingStatus.PROVISIONING,
    });
    await this.provisioningService.recordEvent(
      tenantId,
      'PROVISIONING_STARTED',
      actorType,
      { actorId },
    );

    // provision() is idempotent (checks existing state before acting at
    // every step) — safe for Bull to call again on a retry after a
    // partial failure, see TenantProvisioningService's own doc comment.
    const tenant = await this.provisioningService.provision(params);

    await this.tenantRepo.update(tenant.id, {
      onboardingStatus: TenantOnboardingStatus.ACTIVE,
    });
    await this.provisioningService.recordEvent(
      tenant.id,
      'PROVISIONING_COMPLETED',
      actorType,
      { actorId },
    );

    if (branchInviteToken) {
      await this.branchInviteService.markAccepted(branchInviteToken, tenant.id);
    }
  }

  // Fires once per failed attempt, not only after retries are exhausted —
  // only mark the tenant FAILED and record the event once Bull has given
  // up for good, otherwise a mid-retry attempt would show as failed even
  // though the next attempt might still succeed.
  @OnQueueFailed()
  async onFailed(
    job: Job<TenantProvisioningJobData>,
    error: Error,
  ): Promise<void> {
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) {
      this.logger.warn(
        `Tenant provisioning job for tenant ${job.data.tenantId} failed (attempt ${job.attemptsMade}/${maxAttempts}), will retry: ${error.message}`,
      );
      return;
    }

    this.logger.error(
      `Tenant provisioning job for tenant ${job.data.tenantId} failed permanently after ${job.attemptsMade} attempts: ${error.message}`,
    );
    await this.tenantRepo.update(job.data.tenantId, {
      onboardingStatus: TenantOnboardingStatus.FAILED,
    });
    await this.provisioningService.recordEvent(
      job.data.tenantId,
      'PROVISIONING_FAILED',
      job.data.actorType,
      { actorId: job.data.actorId, metadata: { error: error.message } },
    );
  }
}
