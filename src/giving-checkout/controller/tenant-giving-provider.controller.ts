import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import {
  SetGivingProviderActiveDto,
  UpsertGivingProviderConfigDto,
} from '../dto/upsert-giving-provider-config.dto';
import { TenantGivingProviderService } from '../service/tenant-giving-provider.service';

// Tenant self-service — a church admin sets their own giving-checkout
// vendor credentials. Not under /platform (excluded from TenantMiddleware
// entirely) — this needs the requesting tenant resolved.
@RequiresModule('tithe')
@UseGuards(AdminGuard, ModuleEnabledGuard)
@Controller('finance/giving-providers')
export class TenantGivingProviderController {
  constructor(private readonly service: TenantGivingProviderService) {}

  @RequiresPermission(AdminPermission.TITHE_READ)
  @Get()
  list() {
    return this.service.listProviders();
  }

  @RequiresPermission(AdminPermission.TITHE_WRITE)
  @Put(':providerId')
  upsert(
    @Param('providerId') providerId: string,
    @Body() dto: UpsertGivingProviderConfigDto,
  ) {
    return this.service.upsertConfig(providerId, dto);
  }

  @RequiresPermission(AdminPermission.TITHE_WRITE)
  @Patch(':providerId')
  setActive(
    @Param('providerId') providerId: string,
    @Body() dto: SetGivingProviderActiveDto,
  ) {
    return this.service.setActive(providerId, dto.isActive);
  }
}
