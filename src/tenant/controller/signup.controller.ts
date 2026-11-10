import { AccountTypeService } from '../../account-type/account-type.service';
import { OrganisationTypeEnum } from '../enum/organisation-type.enum';
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
  Query,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../auth/decorator/public.decorator';
import { TenantProvisioningService } from '../service/tenant-provisioning.service';
import { ConfirmSignupDto, SignupDto } from '../dto/signup.dto';
import { Tenant } from '../entity/tenant.entity';
import { TenantOnboardingActorType } from '../enum/tenant-onboarding-actor-type.enum';
import { ChurchRequestService } from '../service/church-request.service';
import { PlatformSettingsService } from '../../platform-admin/service/platform-settings.service';
import { PlatformSettingKey } from '../../platform-admin/enum/platform-setting-key.enum';
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
    private readonly churchRequests: ChurchRequestService,
    private readonly settingsService: PlatformSettingsService,
    private readonly accountTypes: AccountTypeService,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.CREATED)
  @Post('signup')
  async signup(@Body() dto: SignupDto) {
    const open = await this.accountTypes.openSignupTypes();
    if (!open.includes(dto.orgType ?? OrganisationTypeEnum.CHURCH)) {
      throw new ForbiddenException(
        "Sign-up for this kind of account isn't open yet.",
      );
    }
    const tenant = await this.provisioningService.ensurePendingTenant(
      dto.subdomain,
      dto.churchName,
    );

    await this.provisioningService.recordEvent(
      tenant.id,
      'SIGNUP_INITIATED',
      TenantOnboardingActorType.SELF_SERVE,
    );

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

  @Public()
  @Get('signup/settings')
  async settings() {
    return {
      reviewHours: await this.settingsService.getNumber(
        PlatformSettingKey.REQUEST_REVIEW_HOURS,
      ),
      openTypes: await this.accountTypes.openSignupTypes(),
    };
  }

  // Called as someone types, after a short pause. A single lookup on the unique subdomain index.
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('signup/subdomain-availability')
  checkSubdomain(@Query('subdomain') subdomain: string) {
    return this.provisioningService.checkSubdomain(subdomain ?? '');
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
