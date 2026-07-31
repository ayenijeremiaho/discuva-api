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
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { PlanGuard } from '../../billing/guard/plan.guard';
import { RequiresPlan } from '../../billing/decorator/requires-plan.decorator';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';
import { IncidentReportService } from '../service/incident-report.service';
import {
  IncidentReportQueryDto,
  UpdateIncidentStatusDto,
} from '../dto/incident-report.dto';

@UseGuards(AdminGuard, PlanGuard)
@RequiresPlan(PlanFeature.INCIDENT_REPORT)
@Controller('admin/incidents')
export class AdminIncidentReportController {
  constructor(private readonly incidentReportService: IncidentReportService) {}

  @RequiresPermission(AdminPermission.INCIDENT_REPORT_READ)
  @Get()
  async findAll(@Query() query: IncidentReportQueryDto) {
    const { page = 1, limit = 20, status, dateFrom, dateTo } = query;
    const result = await this.incidentReportService.findAll(page, limit, {
      status,
      dateFrom,
      dateTo,
    });
    return {
      ...result,
      data: result.data.map((r) => this.incidentReportService.maskReporter(r)),
    };
  }

  @RequiresPermission(AdminPermission.INCIDENT_REPORT_READ)
  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const report = await this.incidentReportService.findOne(id);
    return this.incidentReportService.maskReporter(report);
  }

  @RequiresPermission(AdminPermission.INCIDENT_REPORT_WRITE)
  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIncidentStatusDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.incidentReportService.updateStatus(id, dto, admin);
  }
}
