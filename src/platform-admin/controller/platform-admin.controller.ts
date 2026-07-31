import {
  Body,
  Controller,
  Get,
  NotImplementedException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PlatformAdminGuard } from '../guard/platform-admin.guard';
import { PlatformAdminAuthService } from '../service/platform-admin-auth.service';

/**
 * Scaffolding only — route shapes match MULTI_TENANT_MIGRATION.md §4.10's
 * capability list so the real implementations (Phase 5) have a contract to
 * fill in, not routes that behave as if they work. Every handler throws
 * until the tenant registry (§4.1) and provisioning service (§4.8) exist.
 */
@Controller('platform')
export class PlatformAdminController {
  constructor(
    private readonly platformAdminAuthService: PlatformAdminAuthService,
  ) {}

  @Post('auth/login')
  async login(@Body() _dto: { email: string; password: string }) {
    return this.platformAdminAuthService.login(_dto.email, _dto.password);
  }

  @UseGuards(PlatformAdminGuard)
  @Get('tenants')
  async listTenants() {
    throw new NotImplementedException(
      'Awaits public.tenants — see MULTI_TENANT_MIGRATION.md §4.1',
    );
  }

  @UseGuards(PlatformAdminGuard)
  @Post('tenants')
  async provisionTenant(@Body() _dto: unknown) {
    throw new NotImplementedException(
      'Awaits TenantProvisioningService — see MULTI_TENANT_MIGRATION.md §4.8',
    );
  }

  @UseGuards(PlatformAdminGuard)
  @Patch('tenants/:id')
  async updateTenant(@Param('id') _id: string, @Body() _dto: unknown) {
    throw new NotImplementedException(
      'Awaits public.tenants — see MULTI_TENANT_MIGRATION.md §4.1',
    );
  }

  @UseGuards(PlatformAdminGuard)
  @Patch('tenants/:id/suspend')
  async suspendTenant(@Param('id') _id: string) {
    throw new NotImplementedException(
      'Awaits public.tenants — see MULTI_TENANT_MIGRATION.md §4.1',
    );
  }

  @UseGuards(PlatformAdminGuard)
  @Patch('tenants/:id/plan')
  async changeTenantPlan(@Param('id') _id: string, @Body() _dto: unknown) {
    throw new NotImplementedException(
      'Awaits public.subscriptions — see MULTI_TENANT_MIGRATION.md §4.11',
    );
  }

  @UseGuards(PlatformAdminGuard)
  @Post('tenants/:id/impersonate')
  async impersonateTenant(@Param('id') _id: string) {
    throw new NotImplementedException(
      'Awaits public.tenants — see MULTI_TENANT_MIGRATION.md §4.1',
    );
  }

  @UseGuards(PlatformAdminGuard)
  @Get('plans')
  async listPlans() {
    throw new NotImplementedException(
      'Awaits public.plans — see MULTI_TENANT_MIGRATION.md §4.11',
    );
  }

  @UseGuards(PlatformAdminGuard)
  @Post('plans')
  async createPlan(@Body() _dto: unknown) {
    throw new NotImplementedException(
      'Awaits public.plans — see MULTI_TENANT_MIGRATION.md §4.11',
    );
  }

  @UseGuards(PlatformAdminGuard)
  @Patch('plans/:id')
  async updatePlan(@Param('id') _id: string, @Body() _dto: unknown) {
    throw new NotImplementedException(
      'Awaits public.plans — see MULTI_TENANT_MIGRATION.md §4.11',
    );
  }

  @UseGuards(PlatformAdminGuard)
  @Get('communication-providers')
  async listCommunicationProviders() {
    throw new NotImplementedException(
      'Awaits public.communication_providers — see MULTI_TENANT_MIGRATION.md §4.12',
    );
  }

  @UseGuards(PlatformAdminGuard)
  @Post('communication-providers')
  async registerCommunicationProvider(@Body() _dto: unknown) {
    throw new NotImplementedException(
      'Awaits public.communication_providers — see MULTI_TENANT_MIGRATION.md §4.12',
    );
  }

  @UseGuards(PlatformAdminGuard)
  @Get('tenants/:id/communication-providers')
  async getTenantCommunicationProviders(@Param('id') _id: string) {
    throw new NotImplementedException(
      'Awaits public.tenant_communication_provider_configs/sms_wallets — see MULTI_TENANT_MIGRATION.md §4.12',
    );
  }
}
