import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PlatformAdminGuard } from '../guard/platform-admin.guard';
import { Public } from '../../auth/decorator/public.decorator';
import { RequiresPlatformPermission } from '../decorator/requires-platform-permission.decorator';
import { CurrentPlatformAdmin } from '../decorator/current-platform-admin.decorator';
import { PlatformAdminAuth } from '../interface/platform-admin-auth.interface';
import { PlatformAdminPermission } from '../enum/platform-admin-permission.enum';
import { PlatformAdminAuthService } from '../service/platform-admin-auth.service';
import { PlatformTenantService } from '../service/platform-tenant.service';
import { PlatformPlanService } from '../service/platform-plan.service';
import { PlatformCommunicationProviderService } from '../service/platform-communication-provider.service';
import { PlatformGivingProviderService } from '../service/platform-giving-provider.service';
import { PlatformAdminLoginDto } from '../dto/platform-admin-login.dto';
import {
  PlatformAdminForgotPasswordDto,
  PlatformAdminResetPasswordDto,
} from '../dto/platform-admin-password-reset.dto';
import { CreateTenantDto } from '../dto/create-tenant.dto';
import { UpdateTenantDto } from '../dto/update-tenant.dto';
import { SuspendTenantDto } from '../dto/suspend-tenant.dto';
import { ChangeTenantPlanDto } from '../dto/change-tenant-plan.dto';
import { ApplyDiscountDto } from '../dto/apply-discount.dto';
import { CreatePlanDto } from '../dto/create-plan.dto';
import { UpdatePlanDto } from '../dto/update-plan.dto';
import { RegisterCommunicationProviderDto } from '../dto/register-communication-provider.dto';
import { RefundCheckoutSessionDto } from '../dto/refund-checkout-session.dto';
import { CheckoutService } from '../../billing/service/checkout.service';

// Route shapes match MULTI_TENANT_MIGRATION.md §4.10's capability list.
//
// @Public() at class level is load-bearing, not decorative: AuthModule
// registers JwtAuthGuard as a global APP_GUARD, which runs on every route
// regardless of any @UseGuards() also applied at the controller/handler
// level (global guards always run in addition to, never instead of,
// per-route ones). Without @Public() here, every /platform/* route would
// first be checked against a TENANT jwt that a platform admin never has,
// and reject before PlatformAdminGuard ever got a chance to run — confirmed
// this empirically (every route, including login, 401'd until this was
// added). @Public() only skips the global JwtAuthGuard; PlatformAdminGuard
// below still runs and is what actually protects everything but login.
@Public()
@Controller('platform')
export class PlatformAdminController {
  constructor(
    private readonly platformAdminAuthService: PlatformAdminAuthService,
    private readonly tenantService: PlatformTenantService,
    private readonly planService: PlatformPlanService,
    private readonly communicationProviderService: PlatformCommunicationProviderService,
    private readonly givingProviderService: PlatformGivingProviderService,
    private readonly checkoutService: CheckoutService,
  ) {}

  @Post('auth/login')
  async login(@Body() dto: PlatformAdminLoginDto) {
    return this.platformAdminAuthService.login(dto.email, dto.password);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('auth/forgot-password')
  async forgotPassword(@Body() dto: PlatformAdminForgotPasswordDto) {
    await this.platformAdminAuthService.forgotPassword(dto.email);
    return {
      message:
        'If an account exists for this email, a reset code has been sent.',
    };
  }

  // Also how a newly-onboarded platform admin sets their initial password —
  // see PlatformAdminManagementService.create().
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('auth/reset-password')
  async resetPassword(@Body() dto: PlatformAdminResetPasswordDto) {
    await this.platformAdminAuthService.resetPassword(dto);
    return { message: 'Password reset successfully. You can now log in.' };
  }

  @UseGuards(PlatformAdminGuard)
  @RequiresPlatformPermission(PlatformAdminPermission.TENANTS_READ)
  @Get('tenants')
  async listTenants() {
    return this.tenantService.listTenants();
  }

  @UseGuards(PlatformAdminGuard)
  @RequiresPlatformPermission(PlatformAdminPermission.TENANTS_WRITE)
  @Post('tenants')
  async provisionTenant(
    @Body() dto: CreateTenantDto,
    @CurrentPlatformAdmin() admin: PlatformAdminAuth,
  ) {
    return this.tenantService.createTenant(dto, admin.id);
  }

  @UseGuards(PlatformAdminGuard)
  @RequiresPlatformPermission(PlatformAdminPermission.TENANTS_READ)
  @Get('tenants/:id/onboarding-events')
  async getOnboardingEvents(@Param('id') id: string) {
    return this.tenantService.getOnboardingEvents(id);
  }

  @UseGuards(PlatformAdminGuard)
  @RequiresPlatformPermission(PlatformAdminPermission.TENANTS_WRITE)
  @Patch('tenants/:id')
  async updateTenant(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.tenantService.updateTenant(id, dto);
  }

  @UseGuards(PlatformAdminGuard)
  @RequiresPlatformPermission(PlatformAdminPermission.TENANTS_WRITE)
  @Patch('tenants/:id/suspend')
  async suspendTenant(@Param('id') id: string, @Body() dto: SuspendTenantDto) {
    return this.tenantService.suspendTenant(id, dto);
  }

  @UseGuards(PlatformAdminGuard)
  @RequiresPlatformPermission(PlatformAdminPermission.TENANTS_WRITE)
  @Patch('tenants/:id/plan')
  async changeTenantPlan(
    @Param('id') id: string,
    @Body() dto: ChangeTenantPlanDto,
  ) {
    return this.tenantService.changeTenantPlan(id, dto);
  }

  @UseGuards(PlatformAdminGuard)
  @RequiresPlatformPermission(PlatformAdminPermission.TENANTS_WRITE)
  @Patch('tenants/:id/discount')
  async applyDiscount(@Param('id') id: string, @Body() dto: ApplyDiscountDto) {
    return this.tenantService.applyDiscount(id, dto);
  }

  @UseGuards(PlatformAdminGuard)
  @RequiresPlatformPermission(PlatformAdminPermission.TENANTS_WRITE)
  @Delete('tenants/:id/discount')
  async removeDiscount(@Param('id') id: string) {
    return this.tenantService.removeDiscount(id);
  }

  @UseGuards(PlatformAdminGuard)
  @RequiresPlatformPermission(PlatformAdminPermission.TENANTS_IMPERSONATE)
  @Post('tenants/:id/impersonate')
  async impersonateTenant(@Param('id') id: string) {
    return this.tenantService.impersonateTenant(id);
  }

  @UseGuards(PlatformAdminGuard)
  @RequiresPlatformPermission(PlatformAdminPermission.PLANS_READ)
  @Get('plans')
  async listPlans() {
    return this.planService.listPlans();
  }

  @UseGuards(PlatformAdminGuard)
  @RequiresPlatformPermission(PlatformAdminPermission.PLANS_WRITE)
  @Post('plans')
  async createPlan(@Body() dto: CreatePlanDto) {
    return this.planService.createPlan(dto);
  }

  @UseGuards(PlatformAdminGuard)
  @RequiresPlatformPermission(PlatformAdminPermission.PLANS_WRITE)
  @Patch('plans/:id')
  async updatePlan(@Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.planService.updatePlan(id, dto);
  }

  @UseGuards(PlatformAdminGuard)
  @RequiresPlatformPermission(PlatformAdminPermission.BILLING_READ)
  @Get('subscriptions')
  async listSubscriptions() {
    return this.planService.listSubscriptions();
  }

  @UseGuards(PlatformAdminGuard)
  @RequiresPlatformPermission(
    PlatformAdminPermission.COMMUNICATION_PROVIDERS_READ,
  )
  @Get('communication-providers')
  async listCommunicationProviders() {
    return this.communicationProviderService.listProviders();
  }

  @UseGuards(PlatformAdminGuard)
  @RequiresPlatformPermission(
    PlatformAdminPermission.COMMUNICATION_PROVIDERS_WRITE,
  )
  @Post('communication-providers')
  async registerCommunicationProvider(
    @Body() dto: RegisterCommunicationProviderDto,
  ) {
    return this.communicationProviderService.registerProvider(dto);
  }

  @UseGuards(PlatformAdminGuard)
  @RequiresPlatformPermission(
    PlatformAdminPermission.COMMUNICATION_PROVIDERS_READ,
  )
  @Get('tenants/:id/communication-providers')
  async getTenantCommunicationProviders(@Param('id') id: string) {
    return this.communicationProviderService.getTenantProviders(id);
  }

  @UseGuards(PlatformAdminGuard)
  @RequiresPlatformPermission(PlatformAdminPermission.BILLING_READ)
  @Get('tenants/:id/billing-sessions')
  async listTenantBillingSessions(@Param('id') id: string) {
    return this.checkoutService.listCheckoutSessions(id);
  }

  // Giving-checkout is money the tenant receives directly (not platform
  // revenue), but it's still a billing/money concern from the platform's
  // support perspective — reuses BILLING_READ rather than adding a new
  // permission just for this one lookup.
  @UseGuards(PlatformAdminGuard)
  @RequiresPlatformPermission(PlatformAdminPermission.BILLING_READ)
  @Get('tenants/:id/giving-providers')
  async getTenantGivingProviders(@Param('id') id: string) {
    return this.givingProviderService.getTenantGivingProviders(id);
  }

  // Support action — refund a specific completed checkout. Does not
  // automatically reverse the tenant-facing effect (plan upgrade) — see
  // CheckoutService.refundCheckoutSession for why.
  @UseGuards(PlatformAdminGuard)
  @RequiresPlatformPermission(PlatformAdminPermission.BILLING_WRITE)
  @Post('billing-sessions/:sessionId/refund')
  async refundCheckoutSession(
    @Param('sessionId') sessionId: string,
    @Body() dto: RefundCheckoutSessionDto,
  ) {
    return this.checkoutService.refundCheckoutSession(
      sessionId,
      dto.amountCents,
    );
  }
}
