import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../auth/decorator/public.decorator';
import { UtilityService } from '../../utility/service/utility.service';
import { TenantProvisioningService } from '../service/tenant-provisioning.service';
import { SignupDto } from '../dto/signup.dto';

// Public, unauthenticated, rate-limited by IP — the primary entry point
// into the self-serve freemium funnel (docs/MULTI_TENANT_MIGRATION.md §4.8).
// Deliberately does NOT auto-login the new admin — issuing a JWT and
// creating a session record correctly requires running that under the same
// tenant-scoped transaction as the seed itself, which is more
// security-sensitive cross-cutting than this pass takes on. The frontend
// redirects to /login after a successful signup instead.
@Controller()
export class SignupController {
  constructor(
    private readonly provisioningService: TenantProvisioningService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.CREATED)
  @Post('signup')
  async signup(@Body() dto: SignupDto) {
    const adminPasswordHash = await UtilityService.hashValue(dto.adminPassword);

    const tenant = await this.provisioningService.provision({
      subdomain: dto.subdomain,
      churchName: dto.churchName,
      adminFirstname: dto.adminFirstname,
      adminLastname: dto.adminLastname,
      adminEmail: dto.adminEmail,
      adminPasswordHash,
      planId: 'free',
    });

    return {
      tenant: {
        id: tenant.id,
        subdomain: tenant.subdomain,
        name: tenant.name,
      },
      message: 'Account created. Please log in to continue.',
    };
  }
}
