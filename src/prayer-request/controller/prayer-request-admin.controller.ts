import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PrayerRequestService } from '../service/prayer-request.service';
import {
  UpdatePrayerRequestStatusDto,
  UpdatePregnancyCaseStatusDto,
} from '../dto/prayer-request.dto';
import { PrayerRequestStatusEnum } from '../enum/prayer-request-status.enum';
import { PregnancyCaseStatusEnum } from '../enum/pregnancy-case-status.enum';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';

@UseGuards(AdminGuard)
@Controller()
export class PrayerRequestAdminController {
  constructor(private readonly prayerRequestService: PrayerRequestService) {}

  @RequiresPermission(AdminPermission.PRAYER_READ)
  @Get('prayer-requests/admin')
  getAll(
    @Query('status') status?: PrayerRequestStatusEnum,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.prayerRequestService.getAllRequestsForTeam(
      Number(page),
      Number(limit),
      status,
    );
  }

  @RequiresPermission(AdminPermission.PRAYER_WRITE)
  @Patch('prayer-requests/admin/:id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePrayerRequestStatusDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.prayerRequestService.updateStatus(id, dto, admin.id);
  }

  @RequiresPermission(AdminPermission.PRAYER_READ)
  @Get('testimonies/admin')
  getAllTestimonies(@Query('page') page = 1, @Query('limit') limit = 10) {
    return this.prayerRequestService.getAllTestimoniesForAdmin(
      Number(page),
      Number(limit),
    );
  }

  @RequiresPermission(AdminPermission.PRAYER_READ)
  @Get('prayer-requests/admin/pregnancy-cases')
  getPregnancyCases(
    @Query('status') status?: PregnancyCaseStatusEnum,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.prayerRequestService.getPregnancyCases(
      Number(page),
      Number(limit),
      status,
    );
  }

  @RequiresPermission(AdminPermission.PRAYER_WRITE)
  @Patch('prayer-requests/admin/pregnancy-cases/:id/status')
  updatePregnancyCaseStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePregnancyCaseStatusDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.prayerRequestService.updatePregnancyCaseStatus(
      id,
      dto,
      admin.id,
    );
  }

  @RequiresPermission(AdminPermission.PRAYER_READ)
  @Get('prayer-requests/admin/pregnancy-cases/:id/visits')
  getPregnancyVisitHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.prayerRequestService.getPregnancyVisitHistory(
      id,
      Number(page),
      Number(limit),
    );
  }
}
