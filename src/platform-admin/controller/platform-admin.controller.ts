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
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { PlatformAdminGuard } from '../guard/platform-admin.guard';
import { PlatformAdminRefreshJwtAuthGuard } from '../guard/platform-admin-refresh-jwt-auth.guard';
import { PLATFORM_REFRESH_COOKIE_NAME } from '../strategy/platform-admin-refresh-jwt.strategy';
import { Public } from '../../auth/decorator/public.decorator';
import { RequiresPlatformPermission } from '../decorator/requires-platform-permission.decorator';
import { CurrentPlatformAdmin } from '../decorator/current-platform-admin.decorator';
import { PlatformAdminAuth } from '../interface/platform-admin-auth.interface';
import { PlatformAdminPermission } from '../enum/platform-admin-permission.enum';
import { PlatformAdminAuthService } from '../service/platform-admin-auth.service';
import { PlatformTenantService } from '../service/platform-tenant.service';
import { PlatformPlanService } from '../service/platform-plan.service';
import { PlatformCapabilityService } from '../service/platform-capability.service';
import { PlatformCommunicationProviderService } from '../service/platform-communication-provider.service';
import { PlatformGivingProviderService } from '../service/platform-giving-provider.service';
import { PlatformPaymentProviderService } from '../service/platform-payment-provider.service';
import { TenantBroadcastService } from '../service/tenant-broadcast.service';
import { PlatformSettingsService } from '../service/platform-settings.service';
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
import { SetCommunicationProviderActiveDto } from '../dto/set-communication-provider-active.dto';
import { RefundCheckoutSessionDto } from '../dto/refund-checkout-session.dto';
import { BroadcastDto } from '../dto/broadcast.dto';
import { RegisterGivingProviderDto } from '../dto/register-giving-provider.dto';
import { SetGivingProviderActiveDto } from '../dto/set-giving-provider-active.dto';
import { SetPaymentProviderActiveDto } from '../dto/set-payment-provider-active.dto';
import { UpdatePlatformSettingDto } from '../dto/platform-setting.dto';
import { PlatformSettingKey } from '../enum/platform-setting-key.enum';
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
    private readonly capabilityService: PlatformCapabilityService,
    private readonly communicationProviderService: PlatformCommunicationProviderService,
    private readonly givingProviderService: PlatformGivingProviderService,
    private readonly paymentProviderService: PlatformPaymentProviderService,
    private readonly checkoutService: CheckoutService,
    private readonly tenantBroadcastService: TenantBroadcastService,
    private readonly platformSettingsService: PlatformSettingsService,
    private readonly configService: ConfigService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('auth/login')
  async login(
    @Body() dto: PlatformAdminLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refreshToken, ...body } = await this.platformAdminAuthService.login(
      dto.email,
      dto.password,
    );
    this.setRefreshCookie(res, refreshToken);
    return body;
  }

  // No @Public() needed beyond the class-level one — PlatformAdminRefreshJwtAuthGuard
  // validates the refresh cookie itself, a completely separate check from
  // PlatformAdminGuard's access-token validation.
  @HttpCode(HttpStatus.OK)
  @UseGuards(PlatformAdminRefreshJwtAuthGuard)
  @Post('auth/refresh')
  async refresh(
    @Request() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const admin: PlatformAdminAuth = req.user;
    const { refreshToken, ...body } =
      await this.platformAdminAuthService.refreshAccessToken(admin.id);
    this.setRefreshCookie(res, refreshToken);
    return body;
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('auth/logout')
  async logout(@Res({ passthrough: true }) res: Response): Promise<void> {
    this.clearRefreshCookie(res);
  }

  private isSecureEnv(): boolean {
    return this.configService.get<string>('NODE_ENV') !== 'development';
  }

  private setRefreshCookie(res: Response, token: string): void {
    const secure = this.isSecureEnv();
    const expiry =
      this.configService.get<string>('PLATFORM_ADMIN_REFRESH_JWT_EXPIRY_IN') ??
      '7d';
    const match = /^(\d+)([smhd])$/i.exec(expiry);
    const units: Record<string, number> = {
      s: 1_000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    const maxAge = match
      ? Number.parseInt(match[1], 10) * (units[match[2].toLowerCase()] ?? 0)
      : 7 * 86_400_000;

    res.cookie(PLATFORM_REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      secure,
      sameSite: secure ? 'none' : 'lax',
      path: '/v1/platform/auth',
      maxAge,
    });
  }

  private clearRefreshCookie(res: Response): void {
    const secure = this.isSecureEnv();
    res.clearCookie(PLATFORM_REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure,
      sameSite: secure ? 'none' : 'lax',
      path: '/v1/platform/auth',
    });
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
  @RequiresPlatformPermission(PlatformAdminPermission.PLANS_READ)
  @Get('capabilities')
  listCapabilities() {
    return this.capabilityService.list();
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
    PlatformAdminPermission.COMMUNICATION_PROVIDERS_WRITE,
  )
  @Patch('communication-providers/:id')
  async setCommunicationProviderActive(
    @Param('id') id: string,
    @Body() dto: SetCommunicationProviderActiveDto,
  ) {
    return this.communicationProviderService.setActive(id, dto.isActive);
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
  // support perspective — reuses BILLING_READ/BILLING_WRITE rather than
  // adding a new permission pair, same reasoning as the tenant-lookup route
  // below already established.
  @UseGuards(PlatformAdminGuard)
  @RequiresPlatformPermission(PlatformAdminPermission.BILLING_READ)
  @Get('giving-providers')
  async listGivingProviders() {
    return this.givingProviderService.listProviders();
  }

  @UseGuards(PlatformAdminGuard)
  @RequiresPlatformPermission(PlatformAdminPermission.BILLING_WRITE)
  @Post('giving-providers')
  async registerGivingProvider(@Body() dto: RegisterGivingProviderDto) {
    return this.givingProviderService.registerProvider(dto);
  }

  @UseGuards(PlatformAdminGuard)
  @RequiresPlatformPermission(PlatformAdminPermission.BILLING_WRITE)
  @Patch('giving-providers/:id')
  async setGivingProviderActive(
    @Param('id') id: string,
    @Body() dto: SetGivingProviderActiveDto,
  ) {
    return this.givingProviderService.setActive(id, dto.isActive);
  }

  @UseGuards(PlatformAdminGuard)
  @RequiresPlatformPermission(PlatformAdminPermission.BILLING_READ)
  @Get('tenants/:id/giving-providers')
  async getTenantGivingProviders(@Param('id') id: string) {
    return this.givingProviderService.getTenantGivingProviders(id);
  }

  // Subscription-billing vendors (paystack/flutterwave/kora) — same
  // BILLING_READ/BILLING_WRITE reuse as giving providers, same reasoning.
  // No register route: these are hard-coded IPaymentProvider classes wired
  // in BillingModule, not arbitrary BYOK entries.
  @UseGuards(PlatformAdminGuard)
  @RequiresPlatformPermission(PlatformAdminPermission.BILLING_READ)
  @Get('payment-providers')
  async listPaymentProviders() {
    return this.paymentProviderService.listProviders();
  }

  @UseGuards(PlatformAdminGuard)
  @RequiresPlatformPermission(PlatformAdminPermission.BILLING_WRITE)
  @Patch('payment-providers/:id')
  async setPaymentProviderActive(
    @Param('id') id: string,
    @Body() dto: SetPaymentProviderActiveDto,
  ) {
    return this.paymentProviderService.setActive(id, dto.isActive);
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

  @UseGuards(PlatformAdminGuard)
  @RequiresPlatformPermission(PlatformAdminPermission.BILLING_READ)
  @Get('settings')
  async listPlatformSettings() {
    return this.platformSettingsService.findAll();
  }

  @UseGuards(PlatformAdminGuard)
  @RequiresPlatformPermission(PlatformAdminPermission.BILLING_WRITE)
  @HttpCode(HttpStatus.OK)
  @Patch('settings/:key')
  async updatePlatformSetting(
    @Param('key') key: PlatformSettingKey,
    @Body() dto: UpdatePlatformSettingDto,
  ) {
    return this.platformSettingsService.upsert(key, dto);
  }

  // Plain text only, not raw HTML — see BroadcastDto's own comment and
  // TenantBroadcastService.plainTextToHtml for why. One email per tenant's
  // oldest active admin, never a single batched call — see
  // TenantBroadcastService's class comment for the privacy reasoning.
  @UseGuards(PlatformAdminGuard)
  @RequiresPlatformPermission(PlatformAdminPermission.BROADCAST_WRITE)
  @Post('broadcast')
  async broadcastToTenants(@Body() dto: BroadcastDto) {
    return this.tenantBroadcastService.broadcastPlainTextToAllTenantAdmins(
      dto.subject,
      dto.message,
    );
  }
}
