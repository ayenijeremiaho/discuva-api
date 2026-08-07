import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { CheckoutService } from '../service/checkout.service';
import { InitiateSubscriptionCheckoutDto } from '../dto/checkout.dto';

// Tenant-facing (AdminGuard) billing surface — view current plan/subscription
// status, and initiate a Paystack or Flutterwave checkout to upgrade the
// plan. Actual activation happens off the BillingWebhookController once the
// provider confirms payment, not here — these routes only ever return a
// checkoutUrl to redirect the admin to.
@UseGuards(AdminGuard)
@Controller('billing')
export class BillingController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @RequiresPermission(AdminPermission.BILLING_READ)
  @Get('summary')
  getSummary() {
    return this.checkoutService.getBillingSummary();
  }

  // Reference data for the plan picker in the checkout flow — a tenant
  // admin has no other way to see what plans exist to upgrade to;
  // GET /platform/plans is platform-admin-only.
  @RequiresPermission(AdminPermission.BILLING_READ)
  @Get('plans')
  listPlans() {
    return this.checkoutService.listPlans();
  }

  @RequiresPermission(AdminPermission.BILLING_WRITE)
  @Post('checkout/subscribe')
  initiateSubscriptionCheckout(
    @Body() dto: InitiateSubscriptionCheckoutDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.checkoutService.initiateSubscriptionCheckout(
      dto.planId,
      admin.member.email,
      dto.provider,
      dto.successUrl,
      dto.cancelUrl,
    );
  }

  // Self-serve counterpart to the platform-admin escape hatch
  // (PATCH /platform/tenants/:id/plan). Cancels immediately if there's no
  // active paid period left to honor, otherwise keeps access until
  // currentPeriodEnd and lets SubscriptionLapseScheduler complete the
  // downgrade — see CheckoutService.cancelSubscription for the full split.
  @RequiresPermission(AdminPermission.BILLING_WRITE)
  @Post('cancel')
  cancelSubscription() {
    return this.checkoutService.cancelSubscription();
  }
}
