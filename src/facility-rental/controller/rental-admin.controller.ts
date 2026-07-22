import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { RentalConfigService } from '../service/rental-config.service';
import { RentalBookingService } from '../service/rental-booking.service';
import { RentalAdminService } from '../service/rental-admin.service';
import {
  CreateRentalFacilityDto,
  UpdateRentalFacilityDto,
} from '../dto/rental-facility.dto';
import { UpsertRentalPricingTierDto } from '../dto/rental-pricing-tier.dto';
import {
  CreateRentalAddonDto,
  UpdateRentalAddonDto,
} from '../dto/rental-addon.dto';
import { CreateRentalCalendarBlockDto } from '../dto/rental-calendar-block.dto';
import {
  ApplyOverrideDiscountDto,
  ConfirmBookingDto,
  RejectBookingDto,
} from '../dto/rental-booking.dto';
import { MarkPaymentPaidDto } from '../dto/rental-payment.dto';
import { RentalBookingStatus } from '../enum/rental.enum';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';

@RequiresModule('facility_rental')
@UseGuards(AdminGuard, ModuleEnabledGuard)
@Controller('facility-rental/admin')
export class RentalAdminController {
  constructor(
    private readonly configService: RentalConfigService,
    private readonly bookingService: RentalBookingService,
    private readonly adminService: RentalAdminService,
  ) {}

  // ── Facilities ──────────────────────────────────────────────────────────────

  @RequiresPermission(AdminPermission.FACILITY_RENTAL_WRITE)
  @Post('facilities')
  createFacility(@Body() dto: CreateRentalFacilityDto) {
    return this.configService.createFacility(dto);
  }

  @RequiresPermission(AdminPermission.FACILITY_RENTAL_READ)
  @Get('facilities')
  getFacilities() {
    return this.configService.getFacilities();
  }

  @RequiresPermission(AdminPermission.FACILITY_RENTAL_WRITE)
  @Patch('facilities/:id')
  updateFacility(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRentalFacilityDto,
  ) {
    return this.configService.updateFacility(id, dto);
  }

  // ── Pricing tiers ───────────────────────────────────────────────────────────

  @RequiresPermission(AdminPermission.FACILITY_RENTAL_WRITE)
  @Post('pricing-tiers')
  upsertPricingTier(@Body() dto: UpsertRentalPricingTierDto) {
    return this.configService.upsertPricingTier(dto);
  }

  @RequiresPermission(AdminPermission.FACILITY_RENTAL_READ)
  @Get('pricing-tiers')
  getPricingTiers() {
    return this.configService.getPricingTiers();
  }

  @RequiresPermission(AdminPermission.FACILITY_RENTAL_WRITE)
  @Delete('pricing-tiers/:id')
  deletePricingTier(@Param('id', ParseUUIDPipe) id: string) {
    return this.configService.deletePricingTier(id);
  }

  // ── Add-ons ─────────────────────────────────────────────────────────────────

  @RequiresPermission(AdminPermission.FACILITY_RENTAL_WRITE)
  @Post('addons')
  createAddon(@Body() dto: CreateRentalAddonDto) {
    return this.configService.createAddon(dto);
  }

  @RequiresPermission(AdminPermission.FACILITY_RENTAL_READ)
  @Get('addons')
  getAddons() {
    return this.configService.getAddons();
  }

  @RequiresPermission(AdminPermission.FACILITY_RENTAL_WRITE)
  @Patch('addons/:id')
  updateAddon(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRentalAddonDto,
  ) {
    return this.configService.updateAddon(id, dto);
  }

  // ── Calendar blocks ─────────────────────────────────────────────────────────

  @RequiresPermission(AdminPermission.FACILITY_RENTAL_WRITE)
  @Post('calendar-blocks')
  createCalendarBlock(@Body() dto: CreateRentalCalendarBlockDto) {
    return this.configService.createCalendarBlock(dto);
  }

  @RequiresPermission(AdminPermission.FACILITY_RENTAL_READ)
  @Get('calendar-blocks')
  getCalendarBlocks(@Query('facilityId', ParseUUIDPipe) facilityId: string) {
    return this.configService.getCalendarBlocks(facilityId);
  }

  @RequiresPermission(AdminPermission.FACILITY_RENTAL_WRITE)
  @Delete('calendar-blocks/:id')
  deleteCalendarBlock(@Param('id', ParseUUIDPipe) id: string) {
    return this.configService.deleteCalendarBlock(id);
  }

  // ── Bookings ────────────────────────────────────────────────────────────────

  @RequiresPermission(AdminPermission.FACILITY_RENTAL_READ)
  @Get('bookings')
  getAllBookings(@Query('status') status?: RentalBookingStatus) {
    return this.adminService.getAllBookings(status);
  }

  @RequiresPermission(AdminPermission.FACILITY_RENTAL_READ)
  @Get('bookings/:id')
  getBooking(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookingService.getBookingById(id);
  }

  @RequiresPermission(AdminPermission.FACILITY_RENTAL_WRITE)
  @Patch('bookings/:id/confirm')
  confirmBooking(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmBookingDto,
  ) {
    return this.adminService.confirmBooking(id, dto);
  }

  @RequiresPermission(AdminPermission.FACILITY_RENTAL_WRITE)
  @Patch('bookings/:id/reject')
  rejectBooking(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectBookingDto,
  ) {
    return this.adminService.rejectBooking(id, dto);
  }

  @RequiresPermission(AdminPermission.FACILITY_RENTAL_WRITE)
  @Patch('bookings/:id/discount')
  applyOverrideDiscount(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyOverrideDiscountDto,
  ) {
    return this.adminService.applyOverrideDiscount(id, dto);
  }

  @RequiresPermission(AdminPermission.FACILITY_RENTAL_WRITE)
  @Delete('bookings/:id/discount')
  removeOverrideDiscount(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.removeOverrideDiscount(id);
  }

  // ── Payments ────────────────────────────────────────────────────────────────

  @RequiresPermission(AdminPermission.FACILITY_RENTAL_WRITE)
  @Patch('payments/:id/paid')
  markPaymentPaid(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkPaymentPaidDto,
  ) {
    return this.adminService.markPaymentPaid(id, dto);
  }

  @RequiresPermission(AdminPermission.FACILITY_RENTAL_WRITE)
  @Patch('payments/:id/refund')
  markCautionRefunded(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.markCautionRefunded(id);
  }
}
