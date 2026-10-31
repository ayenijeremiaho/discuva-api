import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../auth/decorator/public.decorator';
import { TenantProvisioningService } from '../service/tenant-provisioning.service';
import { ConfirmSignupDto, SignupDto } from '../dto/signup.dto';
import { BranchInviteService } from '../../branch/service/branch-invite.service';
import { Tenant } from '../entity/tenant.entity';
import { TenantOnboardingActorType } from '../enum/tenant-onboarding-actor-type.enum';
import { ChurchRequestService } from '../service/church-request.service';
import { TenantOnboardingStatus } from '../enum/tenant-onboarding-status.enum';

// Public, unauthenticated, rate-limited by IP — the primary entry point
// into the self-serve freemium funnel (docs/MULTI_TENANT_MIGRATION.md §4.8).
// Provisioning runs on TenantProvisioningProcessor, not inline here — this
// creates the pending Tenant row and enqueues the job, returning fast
// rather than blocking on CREATE SCHEMA + migrations + seeding.
// Deliberately does NOT auto-login the new admin — issuing a JWT and
// creating a session record correctly requires running that under the same
// tenant-scoped transaction as the seed itself, which is more
// security-sensitive cross-cutting than this pass takes on. The frontend
// redirects to /login after the status endpoint reports ACTIVE instead.
@Controller()
export class SignupController {
  constructor(
    private readonly provisioningService: TenantProvisioningService,
    private readonly branchInviteService: BranchInviteService,
    private readonly churchRequests: ChurchRequestService,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.CREATED)
  @Post('signup')
  async signup(@Body() dto: SignupDto) {
    // Validated (pending, not expired) before provisioning so a bad/expired
    // code fails fast without creating a tenant row first. Consumed by
    // TenantProvisioningProcessor once provisioning actually succeeds, not
    // here — if the job fails, the invite stays pending and usable for a
    // retry with a different subdomain.
    const resolvedInvite = dto.branchInviteToken
      ? await this.branchInviteService.resolveInvite(dto.branchInviteToken)
      : undefined;

    const tenant = await this.provisioningService.ensurePendingTenant(
      dto.subdomain,
      dto.churchName,
      resolvedInvite?.parentTenantId,
    );

    await this.provisioningService.recordEvent(
      tenant.id,
      'SIGNUP_INITIATED',
      TenantOnboardingActorType.SELF_SERVE,
    );

    const pendingParams = {
      adminFirstname: dto.adminFirstname,
      adminLastname: dto.adminLastname,
      adminEmail: dto.adminEmail,
      planId: 'free',
      parentTenantId: resolvedInvite?.parentTenantId,
      sponsoredPlanId: resolvedInvite?.sponsoredPlanId ?? undefined,
      branchInviteToken: dto.branchInviteToken,
    };

    // A branch invite is already vetted, because a parent church's admin issued it. Everything else confirms and is reviewed.
    if (!resolvedInvite) {
      await this.churchRequests.submit(tenant, dto);
      return {
        tenant: {
          id: tenant.id,
          subdomain: tenant.subdomain,
          name: dto.churchName,
          onboardingStatus: TenantOnboardingStatus.AWAITING_CONFIRMATION,
        },
        message: 'Please check your email to confirm your request.',
      };
    }

    await this.provisioningService.enqueueProvisioning({
      tenantId: tenant.id,
      subdomain: dto.subdomain,
      churchName: dto.churchName,
      ...pendingParams,
      actorType: TenantOnboardingActorType.SELF_SERVE,
    });

    return {
      tenant: {
        id: tenant.id,
        subdomain: tenant.subdomain,
        name: tenant.name,
        onboardingStatus: tenant.onboardingStatus,
      },
      message:
        "Account is being created — check back in a moment. We'll email you a link to set your password once it's ready.",
    };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('signup/confirm')
  confirm(@Body() dto: ConfirmSignupDto) {
    return this.churchRequests.confirm(dto.token);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('signup/:tenantId/resend-confirmation')
  async resendConfirmation(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ): Promise<void> {
    await this.churchRequests.resendConfirmations(tenantId);
  }

  @Public()
  @Get('signup/:tenantId/status')
  async getStatus(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    const tenant = await this.tenantRepo.findOneBy({ id: tenantId });
    if (!tenant) throw new NotFoundException('Tenant not found');

    return {
      status: tenant.onboardingStatus,
      subdomain: tenant.subdomain,
      name: tenant.name,
    };
  }
}
