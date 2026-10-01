import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { SundaySchoolReportService } from '../service/sunday-school-report.service';
import {
  SundaySchoolAbsenteeQueryDto,
  SundaySchoolReportQueryDto,
} from '../dto/sunday-school-report.dto';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { SundaySchoolService } from '../service/sunday-school.service';
import { SundaySchoolSettingsService } from '../service/sunday-school-settings.service';
import { UpdateSundaySchoolSettingsDto } from '../dto/sunday-school-settings.dto';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import {
  CreateSundaySchoolClassDto,
  UpdateSundaySchoolClassDto,
} from '../dto/create-sunday-school-class.dto';
import { BulkAssignSundaySchoolMembersDto } from '../dto/bulk-assign-sunday-school-members.dto';
import { AssignSundaySchoolMemberDto } from '../dto/assign-sunday-school-member.dto';
import {
  CreateSundaySchoolSessionDto,
  CreateSundaySchoolSessionSeriesDto,
  OpenSelfMarkDto,
  UpdateSundaySchoolSessionDto,
} from '../dto/create-sunday-school-session.dto';
import { BulkMarkAttendanceDto } from '../dto/bulk-mark-attendance.dto';
import { CheckInFirstTimerDto } from '../dto/checkin-first-timer.dto';
import { AnswerQuestionDto } from '../dto/sunday-school-question.dto';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';

@RequiresModule('sunday_school')
@UseGuards(AdminGuard, ModuleEnabledGuard)
@Controller('admin/sunday-school')
export class SundaySchoolAdminController {
  constructor(
    private readonly sundaySchoolService: SundaySchoolService,
    private readonly settingsService: SundaySchoolSettingsService,
    private readonly reportService: SundaySchoolReportService,
  ) {}

  // ─── Reports ───────────────────────────────────────────────────────────────

  @RequiresPermission(AdminPermission.SUNDAY_SCHOOL_READ)
  @Get('reports/attendance')
  attendanceReport(@Query() query: SundaySchoolReportQueryDto) {
    return this.reportService.attendanceReport(query);
  }

  @RequiresPermission(AdminPermission.SUNDAY_SCHOOL_READ)
  @Get('reports/attendance/export')
  async exportAttendance(
    @Query() query: SundaySchoolReportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { from, to } = this.reportService.resolveRange(query);
    const buffer = await this.reportService.exportWorkbook(query);
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="sunday-school-attendance-${from}-to-${to}.xlsx"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @RequiresPermission(AdminPermission.SUNDAY_SCHOOL_READ)
  @Get('reports/absentees')
  absentees(@Query() query: SundaySchoolAbsenteeQueryDto) {
    return this.reportService.absentees(query.classId, query.misses ?? 3);
  }

  // ─── Settings ──────────────────────────────────────────────────────────────

  @RequiresPermission(AdminPermission.SUNDAY_SCHOOL_READ)
  @Get('settings')
  getSettings() {
    return this.settingsService.getSettings();
  }

  @RequiresPermission(AdminPermission.SUNDAY_SCHOOL_WRITE)
  @Put('settings')
  updateSettings(
    @Body() dto: UpdateSundaySchoolSettingsDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.settingsService.update(dto, admin.member?.id);
  }

  // ─── Classes ───────────────────────────────────────────────────────────────

  @RequiresPermission(AdminPermission.SUNDAY_SCHOOL_READ)
  @Get('classes')
  getAllClasses(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.sundaySchoolService.getAllClasses(+page, +limit);
  }

  @RequiresPermission(AdminPermission.SUNDAY_SCHOOL_WRITE)
  @Post('classes')
  createClass(@Body() dto: CreateSundaySchoolClassDto) {
    return this.sundaySchoolService.adminCreateClass(dto);
  }

  @RequiresPermission(AdminPermission.SUNDAY_SCHOOL_WRITE)
  @Patch('classes/:id')
  updateClass(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSundaySchoolClassDto,
  ) {
    return this.sundaySchoolService.adminUpdateClass(id, dto);
  }

  @RequiresPermission(AdminPermission.SUNDAY_SCHOOL_WRITE)
  @Delete('classes/:id')
  deleteClass(@Param('id', ParseUUIDPipe) id: string) {
    return this.sundaySchoolService.deleteClass(id);
  }

  @RequiresPermission(AdminPermission.SUNDAY_SCHOOL_READ)
  @Get('classes/:id/members')
  getClassMembers(
    @Param('id', ParseUUIDPipe) classId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.sundaySchoolService.getClassMembers(classId, +page, +limit);
  }

  @RequiresPermission(AdminPermission.SUNDAY_SCHOOL_WRITE)
  @Post('classes/:id/members')
  assignMember(
    @Param('id', ParseUUIDPipe) classId: string,
    @Body() dto: AssignSundaySchoolMemberDto,
  ) {
    return this.sundaySchoolService.adminAssignMember(classId, dto.memberId);
  }

  // Members not yet in this class, for the bulk-add picker.
  @RequiresPermission(AdminPermission.SUNDAY_SCHOOL_READ)
  @Get('classes/:id/candidates')
  getClassCandidates(
    @Param('id', ParseUUIDPipe) classId: string,
    @Query('search') search?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    return this.sundaySchoolService.adminClassCandidates(
      classId,
      search,
      +page || 1,
      +limit || 50,
    );
  }

  @RequiresPermission(AdminPermission.SUNDAY_SCHOOL_WRITE)
  @Post('classes/:id/members/bulk')
  bulkAssignMembers(
    @Param('id', ParseUUIDPipe) classId: string,
    @Body() dto: BulkAssignSundaySchoolMembersDto,
  ) {
    return this.sundaySchoolService.adminBulkAssignMembers(
      classId,
      dto.memberIds,
      dto.emails,
    );
  }

  @RequiresPermission(AdminPermission.SUNDAY_SCHOOL_WRITE)
  @Delete('classes/:id/members/:memberId')
  removeMember(
    @Param('id', ParseUUIDPipe) classId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    return this.sundaySchoolService.adminRemoveMember(classId, memberId);
  }

  // ─── Sessions ──────────────────────────────────────────────────────────────

  @RequiresPermission(AdminPermission.SUNDAY_SCHOOL_READ)
  @Get('sessions')
  getSessions(
    @Query('classId', ParseUUIDPipe) classId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.sundaySchoolService.adminGetSessions(classId, +page, +limit);
  }

  @RequiresPermission(AdminPermission.SUNDAY_SCHOOL_WRITE)
  @Post('sessions')
  createSession(@Body() dto: CreateSundaySchoolSessionDto) {
    return this.sundaySchoolService.adminCreateSession(dto);
  }

  @RequiresPermission(AdminPermission.SUNDAY_SCHOOL_WRITE)
  @Post('sessions/series')
  createSessionSeries(@Body() dto: CreateSundaySchoolSessionSeriesDto) {
    return this.sundaySchoolService.adminCreateSessionSeries(dto);
  }

  @RequiresPermission(AdminPermission.SUNDAY_SCHOOL_WRITE)
  @Patch('sessions/:id')
  updateSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSundaySchoolSessionDto,
  ) {
    return this.sundaySchoolService.adminUpdateSession(id, dto);
  }

  @RequiresPermission(AdminPermission.SUNDAY_SCHOOL_WRITE)
  @Delete('sessions/:id')
  deleteSession(@Param('id', ParseUUIDPipe) id: string) {
    return this.sundaySchoolService.adminDeleteSession(id);
  }

  @RequiresPermission(AdminPermission.SUNDAY_SCHOOL_WRITE)
  @Patch('sessions/:id/open')
  openSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OpenSelfMarkDto,
  ) {
    return this.sundaySchoolService.adminOpenSession(id, dto.closesInMinutes);
  }

  @RequiresPermission(AdminPermission.SUNDAY_SCHOOL_WRITE)
  @Patch('sessions/:id/close')
  closeSession(@Param('id', ParseUUIDPipe) id: string) {
    return this.sundaySchoolService.adminCloseSession(id);
  }

  @RequiresPermission(AdminPermission.SUNDAY_SCHOOL_READ)
  @Get('sessions/:id/roster')
  getSessionRoster(@Param('id', ParseUUIDPipe) id: string) {
    return this.sundaySchoolService.adminGetSessionRoster(id);
  }

  @RequiresPermission(AdminPermission.SUNDAY_SCHOOL_WRITE)
  @Post('sessions/:id/checkin-first-timer')
  checkInFirstTimer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CheckInFirstTimerDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.sundaySchoolService.adminCheckInFirstTimer(id, dto, admin.id);
  }

  @RequiresPermission(AdminPermission.SUNDAY_SCHOOL_WRITE)
  @Post('sessions/:id/bulk-mark')
  bulkMarkAttendance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BulkMarkAttendanceDto,
  ) {
    return this.sundaySchoolService.adminBulkMarkAttendance(id, dto);
  }

  // ─── Questions (Q&A) ──────────────────────────────────────────────────────

  @RequiresPermission(AdminPermission.SUNDAY_SCHOOL_READ)
  @Get('questions')
  getAllQuestions(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.sundaySchoolService.adminGetAllQuestions(+page, +limit);
  }

  @RequiresPermission(AdminPermission.SUNDAY_SCHOOL_READ)
  @Get('classes/:id/questions')
  getQuestionsForClass(
    @Param('id', ParseUUIDPipe) classId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.sundaySchoolService.adminGetQuestionsForClass(
      classId,
      +page,
      +limit,
    );
  }

  @RequiresPermission(AdminPermission.SUNDAY_SCHOOL_WRITE)
  @Patch('questions/:id/answer')
  answerQuestion(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AnswerQuestionDto,
  ) {
    return this.sundaySchoolService.adminAnswerQuestion(id, dto, req.user.id);
  }

  @RequiresPermission(AdminPermission.SUNDAY_SCHOOL_WRITE)
  @Delete('questions/:id')
  deleteQuestion(@Param('id', ParseUUIDPipe) id: string) {
    return this.sundaySchoolService.adminDeleteQuestion(id);
  }
}
