import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { AssetService } from '../service/asset.service';
import { AssetCheckoutService } from '../service/asset-checkout.service';
import {
  AssetQueryDto,
  CreateAssetDto,
  CreateCheckoutDto,
  LogMaintenanceRecordDto,
  ReturnAssetDto,
  SetMaintenanceScheduleDto,
  UpdateAssetDto,
  UpdateInventoryDto,
} from '../dto/asset.dto';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { PlanGuard } from '../../billing/guard/plan.guard';
import { RequiresPlan } from '../../billing/decorator/requires-plan.decorator';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';

@RequiresModule('asset_management')
@RequiresPlan(PlanFeature.ASSET_MANAGEMENT)
@UseGuards(AdminGuard, ModuleEnabledGuard, PlanGuard)
@Controller('admin/assets')
export class AssetController {
  constructor(
    private readonly assetService: AssetService,
    private readonly assetCheckoutService: AssetCheckoutService,
  ) {}

  @RequiresPermission(AdminPermission.ASSET_MANAGEMENT_WRITE)
  @Post()
  create(@Body() dto: CreateAssetDto, @CurrentAdmin() admin: Admin) {
    return this.assetService.create(dto, admin);
  }

  @RequiresPermission(AdminPermission.ASSET_MANAGEMENT_READ)
  @Get()
  findAll(@Query() query: AssetQueryDto) {
    return this.assetService.findAll(query);
  }

  // Static routes must come before :id to avoid route shadowing
  @RequiresPermission(AdminPermission.ASSET_MANAGEMENT_READ)
  @Get('checkouts')
  getActiveCheckouts(
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    return this.assetCheckoutService.getActiveCheckouts(page, limit);
  }

  @RequiresPermission(AdminPermission.ASSET_MANAGEMENT_READ)
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.assetService.findOne(id);
  }

  @RequiresPermission(AdminPermission.ASSET_MANAGEMENT_WRITE)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssetDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.assetService.update(id, dto, admin);
  }

  @RequiresPermission(AdminPermission.ASSET_MANAGEMENT_WRITE)
  @Post(':id/maintenance-schedule')
  setMaintenanceSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetMaintenanceScheduleDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.assetService.setMaintenanceSchedule(id, dto, admin);
  }

  @RequiresPermission(AdminPermission.ASSET_MANAGEMENT_WRITE)
  @Post(':id/maintenance-records')
  logMaintenanceRecord(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LogMaintenanceRecordDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.assetService.logMaintenanceRecord(id, dto, admin);
  }

  @RequiresPermission(AdminPermission.ASSET_MANAGEMENT_WRITE)
  @Patch(':id/inventory')
  updateInventory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInventoryDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.assetService.updateInventory(id, dto, admin);
  }

  @RequiresPermission(AdminPermission.ASSET_MANAGEMENT_READ)
  @Get(':id/maintenance-records')
  getMaintenanceHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    return this.assetService.getMaintenanceHistory(id, page, limit);
  }

  @RequiresPermission(AdminPermission.ASSET_MANAGEMENT_WRITE)
  @Post(':id/checkouts')
  createCheckout(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCheckoutDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.assetCheckoutService.create(id, dto, admin);
  }

  @RequiresPermission(AdminPermission.ASSET_MANAGEMENT_WRITE)
  @Patch(':id/checkouts/:checkoutId/return')
  returnAsset(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('checkoutId', ParseUUIDPipe) checkoutId: string,
    @Body() dto: ReturnAssetDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.assetCheckoutService.returnAsset(id, checkoutId, dto, admin);
  }

  @RequiresPermission(AdminPermission.ASSET_MANAGEMENT_READ)
  @Get(':id/checkouts')
  getCheckoutHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    return this.assetCheckoutService.getHistory(id, page, limit);
  }
}
