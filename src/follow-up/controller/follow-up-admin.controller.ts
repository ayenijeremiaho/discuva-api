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
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { IsOptional, IsUUID } from 'class-validator';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { FollowUpService } from '../service/follow-up.service';
import { DateService } from '../../utility/service/date.service';
import { PdfService } from '../../utility/service/pdf.service';
import { FirstTimerCardService } from '../service/first-timer-card.service';
import { FollowUpMonthlyReportService } from '../service/follow-up-monthly-report.service';
import {
  CreateFirstTimerFieldDto,
  ReorderFirstTimerFieldsDto,
  UpdateFirstTimerFieldDto,
} from '../dto/first-timer-field.dto';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { FirstTimerConvertService } from '../service/first-timer-convert.service';
import { LinkConvertDto } from '../dto/link-convert.dto';
import { CreateFirstTimerDto } from '../dto/create-first-timer.dto';
import { ReassignTaskDto } from '../dto/reassign-task.dto';
import { BulkUpdateTasksDto } from '../dto/bulk-update-tasks.dto';
import { AdminUpdateFollowUpTaskDto } from '../dto/admin-update-follow-up-task.dto';
import { LogVisitDto } from '../dto/log-visit.dto';
import { UpdateFirstTimerDto } from '../dto/update-first-timer.dto';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import {
  FirstTimerSourceEnum,
  FollowUpTaskStatusEnum,
  FollowUpTaskTypeEnum,
} from '../enums/follow-up.enum';

class MarkConvertedDto {
  @IsOptional()
  @IsUUID()
  memberId?: string;
}

@RequiresModule('follow_up')
@UseGuards(AdminGuard, ModuleEnabledGuard)
@Controller('admin/follow-up')
export class FollowUpAdminController {
  constructor(
    private readonly followUpService: FollowUpService,
    private readonly firstTimerConvertService: FirstTimerConvertService,
    private readonly dateService: DateService,
    private readonly cardService: FirstTimerCardService,
    private readonly monthlyReportService: FollowUpMonthlyReportService,
    private readonly pdfService: PdfService,
  ) {}

  @RequiresPermission(AdminPermission.FOLLOW_UP_READ)
  @Get('card-fields')
  getCardFields() {
    return this.cardService.findAll();
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_WRITE)
  @Post('card-fields')
  createCardField(
    @Body() dto: CreateFirstTimerFieldDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.cardService.create(dto, user.id);
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_WRITE)
  @Patch('card-fields/order')
  reorderCardFields(
    @Body() dto: ReorderFirstTimerFieldsDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.cardService.reorder(dto.ids, user.id);
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_WRITE)
  @Patch('card-fields/:id')
  updateCardField(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFirstTimerFieldDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.cardService.update(id, dto, user.id);
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_WRITE)
  @Delete('card-fields/:id')
  async deleteCardField(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: MemberAuth,
  ) {
    await this.cardService.remove(id, user.id);
    return { deleted: true };
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_READ)
  @Get('report/monthly')
  getMonthlyReport(@Query('month') month: string) {
    return this.monthlyReportService.getReport(month ?? '');
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_READ)
  @Get('report/monthly.pdf')
  async getMonthlyReportPdf(
    @Query('month') month: string,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.monthlyReportService.getReport(month ?? '');
    const pdf = await this.pdfService.generateFollowUpMonthlyReport(report);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="follow-up-report-${report.month}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.end(pdf);
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_WRITE)
  @Post('first-timers')
  async createFirstTimer(
    @CurrentAdmin() admin: Admin,
    @Body() dto: CreateFirstTimerDto,
  ) {
    return this.followUpService.createFirstTimerByAdmin(dto, admin.id);
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_WRITE)
  @Patch('first-timers/:id')
  async updateFirstTimer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFirstTimerDto,
  ) {
    return this.followUpService.updateFirstTimer(id, dto);
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_READ)
  @Get('first-timers')
  async getFirstTimers(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('eventId') eventId?: string,
    @Query('source') source?: FirstTimerSourceEnum,
    @Query('wantsToJoinChurch') wantsToJoinChurch?: string,
    @Query('wantsToJoinWorkforce') wantsToJoinWorkforce?: string,
    @Query('search') search?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    let joinChurch: boolean | undefined;
    if (wantsToJoinChurch === 'true') joinChurch = true;
    else if (wantsToJoinChurch === 'false') joinChurch = false;

    let joinWorkforce: boolean | undefined;
    if (wantsToJoinWorkforce === 'true') joinWorkforce = true;
    else if (wantsToJoinWorkforce === 'false') joinWorkforce = false;
    return this.followUpService.getFirstTimers(
      +page,
      +limit,
      eventId,
      source,
      joinChurch,
      joinWorkforce,
      search,
      dateFrom && this.dateService.rangeBound(dateFrom, 'start').toISOString(),
      dateTo && this.dateService.rangeBound(dateTo, 'end').toISOString(),
    );
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_READ)
  @Get('tasks')
  async getAllTasks(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('status') status?: FollowUpTaskStatusEnum,
    @Query('type') type?: FollowUpTaskTypeEnum,
    @Query('search') search?: string,
  ) {
    return this.followUpService.getAllTasks(
      +page,
      +limit,
      status,
      type,
      search,
    );
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_WRITE)
  @Patch('tasks/:id/reassign')
  async reassignTask(
    @CurrentAdmin() admin: Admin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReassignTaskDto,
  ) {
    return this.followUpService.reassignTask(id, dto, admin.id);
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_READ)
  @Get('workers')
  async getActiveFollowUpWorkers() {
    return this.followUpService.getActiveFollowUpWorkers();
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_WRITE)
  @Patch('tasks/bulk')
  async bulkUpdateTasks(@Body() dto: BulkUpdateTasksDto) {
    return this.followUpService.bulkUpdateTasks(dto);
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_WRITE)
  @Post('first-timers/:id/invite-to-membership')
  async inviteToMembership(@Param('id', ParseUUIDPipe) id: string) {
    return this.followUpService.inviteFirstTimerToMembership(id);
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_WRITE)
  @Patch('first-timers/:id/mark-converted')
  async markConverted(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkConvertedDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.followUpService.markConverted(
      id,
      dto.memberId,
      admin.member?.id,
    );
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_WRITE)
  @Post('first-timers/:id/link-convert')
  linkConvert(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkConvertDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.firstTimerConvertService.link(
      id,
      dto.convertId,
      admin.member.id,
    );
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_WRITE)
  @Post('first-timers/:id/dismiss-convert')
  dismissConvert(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkConvertDto,
  ) {
    return this.firstTimerConvertService.dismiss(id, dto.convertId);
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_WRITE)
  @Delete('first-timers/:id/link-convert')
  unlinkConvert(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.firstTimerConvertService.unlink(id, admin.member.id);
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_WRITE)
  @Patch('tasks/:id')
  async adminUpdateTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateFollowUpTaskDto,
  ) {
    return this.followUpService.adminUpdateTask(id, dto);
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_READ)
  @Get('report')
  async getReport(@Query('from') from?: string, @Query('to') to?: string) {
    return this.followUpService.getReport(
      from ? this.dateService.rangeBound(from, 'start') : undefined,
      to ? this.dateService.rangeBound(to, 'end') : undefined,
    );
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_READ)
  @Get('first-timers/pipeline')
  async getPipeline(@Query('from') from?: string, @Query('to') to?: string) {
    return this.followUpService.getFirstTimerPipeline(
      from && this.dateService.rangeBound(from, 'start').toISOString(),
      to && this.dateService.rangeBound(to, 'end').toISOString(),
    );
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_WRITE)
  @Post('first-timers/:id/visits')
  async logVisit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LogVisitDto,
  ) {
    return this.followUpService.logReturnVisit(id, dto);
  }

  // Declared after first-timers/pipeline so that static path still matches.
  @RequiresPermission(AdminPermission.FOLLOW_UP_READ)
  @Get('first-timers/:id')
  async getFirstTimerDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.followUpService.getFirstTimerDetail(id);
  }

  @RequiresPermission(AdminPermission.FOLLOW_UP_READ)
  @Get('tasks/stale')
  async getStaleTasks(
    @Query('daysInactive') daysInactive = 7,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.followUpService.getStaleTasks(+daysInactive, +page, +limit);
  }
}
