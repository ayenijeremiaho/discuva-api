import { Controller, Get } from '@nestjs/common';
import { Public } from '../../auth/decorator/public.decorator';
import { CheckoutService } from '../service/checkout.service';

// Unauthenticated, no tenant context — called directly by discuva-web (the
// public marketing site) to render real pricing. @Public() is required to
// bypass the global JwtAuthGuard (APP_GUARD in auth.module.ts); must also
// stay excluded from TenantMiddleware (src/tenant/tenant.module.ts), since a
// marketing-site request has no tenant subdomain in its Host header at all.
@Public()
@Controller('billing/public')
export class PublicBillingController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @Get('plans')
  listPublicPlans() {
    return this.checkoutService.listPublicPlans();
  }
}
