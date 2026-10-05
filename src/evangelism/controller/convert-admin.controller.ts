import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { ConvertService } from '../service/convert.service';
import { OutreachService } from '../service/outreach.service';
import { EvangelismSettingsService } from '../service/evangelism-settings.service';
import { EvangelismReportService } from '../service/evangelism-report.service';
import {
  BulkReassignConvertsDto,
  ConvertListQueryDto,
  ExportQueryDto,
  LinkConvertToMemberDto,
  MoveConvertOutreachDto,
  ReassignConvertDto,
  ReportRangeQueryDto,
  UpdateEvangelismSettingsDto,
  UpdateOutreachTeamDto,
} from '../dto/convert.dto';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { PlanGuard } from '../../billing/guard/plan.guard';
import { RequiresPlan } from '../../billing/decorator/requires-plan.decorator';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';

@RequiresModule('evangelism')
@UseGuards(AdminGuard, ModuleEnabledGuard)
@Controller('evangelism')
export class ConvertAdminController {
  constructor(
    private readonly convertService: ConvertService,
    private readonly outreachService: OutreachService,
    private readonly settingsService: EvangelismSettingsService,
    private readonly reportService: EvangelismReportService,
  ) {}

  @RequiresPermission(AdminPermission.EVANGELISM_READ)
  @Get('converts/admin')
  list(@Query() query: ConvertListQueryDto) {
    return this.convertService.listForAdmin(query);
  }

  @RequiresPermission(AdminPermission.EVANGELISM_READ)
  @Get('converts/admin/workers')
  searchWorkers(@Query('q') q?: string) {
    return this.outreachService.searchWorkers(q);
  }

  @RequiresPermission(AdminPermission.EVANGELISM_WRITE)
  @Patch('converts/admin/bulk-reassign')
  bulkReassign(
    @Body() dto: BulkReassignConvertsDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.convertService.bulkReassign(dto, admin.member.id);
  }

  @RequiresPermission(AdminPermission.EVANGELISM_WRITE)
  @Patch('converts/admin/:id/reassign')
  reassign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReassignConvertDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.convertService.reassignConvert(id, dto, admin.member.id);
  }

  @RequiresPermission(AdminPermission.EVANGELISM_WRITE)
  @Patch('converts/admin/:id/unassign')
  unassign(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.convertService.unassignConvert(id, admin.member.id);
  }

  @RequiresPermission(AdminPermission.EVANGELISM_WRITE)
  @Patch('converts/admin/:id/outreach')
  moveToOutreach(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveConvertOutreachDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.convertService.moveToOutreach(
      id,
      dto.outreachId,
      admin.member.id,
    );
  }

  @RequiresPermission(AdminPermission.EVANGELISM_WRITE)
  @Patch('converts/admin/:id/link-member')
  linkMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkConvertToMemberDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.convertService.linkToMember(id, dto, admin.member.id);
  }

  @RequiresPermission(AdminPermission.EVANGELISM_READ)
  @Get('converts/admin/:id/follow-up-history')
  getFollowUpHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.convertService.getFollowUpHistory(
      id,
      Number(page),
      Number(limit),
    );
  }

  @RequiresPermission(AdminPermission.EVANGELISM_READ)
  @Get('outreaches/admin')
  listOutreaches(@Query() query: ReportRangeQueryDto) {
    return this.outreachService.listForAdmin(query.from, query.to);
  }

  @RequiresPermission(AdminPermission.EVANGELISM_WRITE)
  @Patch('outreaches/admin/:id/team')
  updateOutreachTeam(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOutreachTeamDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.outreachService.updateTeam(
      id,
      dto.teamMemberIds,
      {
        memberId: admin.member.id,
        name: `${admin.member.firstname} ${admin.member.lastname}`,
      },
      { asAdmin: true },
    );
  }

  @RequiresPermission(AdminPermission.EVANGELISM_READ)
  @Get('settings/admin')
  getSettings() {
    return this.settingsService.get();
  }

  @RequiresPermission(AdminPermission.EVANGELISM_WRITE)
  @Patch('settings/admin')
  updateSettings(
    @Body() dto: UpdateEvangelismSettingsDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.settingsService.update(dto, admin.member.id);
  }

  @RequiresPermission(AdminPermission.EVANGELISM_READ)
  @Get('report')
  getReport(@Query() query: ReportRangeQueryDto) {
    return this.reportService.getReport(query.from, query.to);
  }

  @RequiresPermission(AdminPermission.EVANGELISM_READ)
  @RequiresPlan(PlanFeature.BULK_EXPORT)
  @UseGuards(PlanGuard)
  @Get('export')
  async export(@Query() query: ExportQueryDto, @Res() res: Response) {
    const { type, ...filters } = query;
    const csv = await this.reportService.exportCsv(type, filters);
    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="evangelism-${type}.csv"`,
    });
    res.end(csv);
  }
}
