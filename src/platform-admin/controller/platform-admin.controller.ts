import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PlatformAdminGuard } from '../guard/platform-admin.guard';
import { Public } from '../../auth/decorator/public.decorator';
import { PlatformAdminAuthService } from '../service/platform-admin-auth.service';
import { PlatformTenantService } from '../service/platform-tenant.service';
import { PlatformPlanService } from '../service/platform-plan.service';
import { PlatformCommunicationProviderService } from '../service/platform-communication-provider.service';
import { PlatformAdminLoginDto } from '../dto/platform-admin-login.dto';
import { CreateTenantDto } from '../dto/create-tenant.dto';
import { UpdateTenantDto } from '../dto/update-tenant.dto';
import { SuspendTenantDto } from '../dto/suspend-tenant.dto';
import { ChangeTenantPlanDto } from '../dto/change-tenant-plan.dto';
import { CreatePlanDto } from '../dto/create-plan.dto';
import { UpdatePlanDto } from '../dto/update-plan.dto';
import { RegisterCommunicationProviderDto } from '../dto/register-communication-provider.dto';

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
  ) {}

  @Post('auth/login')
  async login(@Body() dto: PlatformAdminLoginDto) {
    return this.platformAdminAuthService.login(dto.email, dto.password);
  }

  @UseGuards(PlatformAdminGuard)
  @Get('tenants')
  async listTenants() {
    return this.tenantService.listTenants();
  }

  @UseGuards(PlatformAdminGuard)
  @Post('tenants')
  async provisionTenant(@Body() dto: CreateTenantDto) {
    return this.tenantService.createTenant(dto);
  }

  @UseGuards(PlatformAdminGuard)
  @Patch('tenants/:id')
  async updateTenant(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.tenantService.updateTenant(id, dto);
  }

  @UseGuards(PlatformAdminGuard)
  @Patch('tenants/:id/suspend')
  async suspendTenant(@Param('id') id: string, @Body() dto: SuspendTenantDto) {
    return this.tenantService.suspendTenant(id, dto);
  }

  @UseGuards(PlatformAdminGuard)
  @Patch('tenants/:id/plan')
  async changeTenantPlan(
    @Param('id') id: string,
    @Body() dto: ChangeTenantPlanDto,
  ) {
    return this.tenantService.changeTenantPlan(id, dto);
  }

  @UseGuards(PlatformAdminGuard)
  @Post('tenants/:id/impersonate')
  async impersonateTenant(@Param('id') id: string) {
    return this.tenantService.impersonateTenant(id);
  }

  @UseGuards(PlatformAdminGuard)
  @Get('plans')
  async listPlans() {
    return this.planService.listPlans();
  }

  @UseGuards(PlatformAdminGuard)
  @Post('plans')
  async createPlan(@Body() dto: CreatePlanDto) {
    return this.planService.createPlan(dto);
  }

  @UseGuards(PlatformAdminGuard)
  @Patch('plans/:id')
  async updatePlan(@Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.planService.updatePlan(id, dto);
  }

  @UseGuards(PlatformAdminGuard)
  @Get('subscriptions')
  async listSubscriptions() {
    return this.planService.listSubscriptions();
  }

  @UseGuards(PlatformAdminGuard)
  @Get('communication-providers')
  async listCommunicationProviders() {
    return this.communicationProviderService.listProviders();
  }

  @UseGuards(PlatformAdminGuard)
  @Post('communication-providers')
  async registerCommunicationProvider(
    @Body() dto: RegisterCommunicationProviderDto,
  ) {
    return this.communicationProviderService.registerProvider(dto);
  }

  @UseGuards(PlatformAdminGuard)
  @Get('tenants/:id/communication-providers')
  async getTenantCommunicationProviders(@Param('id') id: string) {
    return this.communicationProviderService.getTenantProviders(id);
  }
}
