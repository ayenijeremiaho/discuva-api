import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { ClassSessionService } from '../service/class-session.service';
import { ClassProgressService } from '../service/class-progress.service';
import { ClassFacilitatorAccessService } from '../service/class-facilitator-access.service';
import { ClassJoinRequestService } from '../service/class-join-request.service';
import { ClassCertificateService } from '../service/class-certificate.service';
import { ClassReportService } from '../service/class-report.service';
import { AssignmentService } from '../service/assignment.service';
import {
  CreateClassSessionDto,
  CreateClassSessionSeriesDto,
  MarkClassAttendanceDto,
  UpdateClassSessionScheduleDto,
} from '../dto/class-session.dto';
import {
  CreateClassJoinRequestDto,
  DeclineClassJoinRequestDto,
} from '../dto/class-join-request.dto';
import { ClassReportQueryDto } from '../dto/class-report.dto';
import { GradeAssignmentDto } from '../dto/assignment.dto';
import { EnrollmentStatusEnum } from '../enum/enrollment-status.enum';

const sendPdf = (res: Response, buffer: Buffer, filename: string) => {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': buffer.length,
  });
  res.end(buffer);
};

// Sessions & attendance, progress, facilitator tools, join requests, certificates and reports.
// Registered before ClassesController so literal paths (teaching, reports, my/...) aren't taken as :id.
@RequiresModule('classes')
@UseGuards(JwtAuthGuard, ModuleEnabledGuard)
@Controller('classes')
export class ClassTrainingController {
  constructor(
    private readonly sessions: ClassSessionService,
    private readonly progress: ClassProgressService,
    private readonly facilitators: ClassFacilitatorAccessService,
    private readonly joinRequests: ClassJoinRequestService,
    private readonly certificates: ClassCertificateService,
    private readonly reports: ClassReportService,
    private readonly assignments: AssignmentService,
  ) {}

  // ─── Reports (admin) ───────────────────────────────────────────────────────

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_READ)
  @Get('reports/summary')
  reportSummary(@Query() query: ClassReportQueryDto) {
    return this.reports.summary(query);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_READ)
  @Get('reports/export')
  async reportExport(
    @Query() query: ClassReportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const buffer = await this.reports.exportWorkbook(query);
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="training-classes-${query.from ?? 'all'}-to-${query.to ?? 'today'}.xlsx"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  // ─── Member: requests, own progress, certificate ───────────────────────────

  @Get('my/join-requests')
  myJoinRequests(@CurrentUser() user: MemberAuth) {
    return this.joinRequests.myRequests(user.id);
  }

  @Get('my/enrollments/:enrollmentId/certificate')
  async myCertificate(
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
    @CurrentUser() user: MemberAuth,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.certificates.pdf(enrollmentId, {
      memberId: user.id,
    });
    sendPdf(res, buffer, filename);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('join-requests/:requestId')
  withdrawJoinRequest(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.joinRequests.withdraw(requestId, user.id);
  }

  // ─── Facilitator (member app) ──────────────────────────────────────────────

  @Get('teaching')
  myFacilitatedClasses(@CurrentUser() user: MemberAuth) {
    return this.facilitators.myClasses(user.id);
  }

  @Patch('teaching/sessions/:sessionId')
  async facilitatorUpdateSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: UpdateClassSessionScheduleDto,
    @CurrentUser() user: MemberAuth,
  ) {
    await this.facilitators.assertSessionFacilitator(user.id, sessionId);
    return this.sessions.updateSession(sessionId, dto);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('teaching/sessions/:sessionId')
  async facilitatorDeleteSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: MemberAuth,
  ) {
    await this.facilitators.assertSessionFacilitator(user.id, sessionId);
    return this.sessions.deleteSession(sessionId);
  }

  @Get('teaching/sessions/:sessionId/roster')
  async facilitatorRoster(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: MemberAuth,
  ) {
    await this.facilitators.assertSessionFacilitator(user.id, sessionId);
    return this.sessions.getRoster(sessionId);
  }

  @Post('teaching/sessions/:sessionId/attendance')
  async facilitatorMark(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: MarkClassAttendanceDto,
    @CurrentUser() user: MemberAuth,
  ) {
    await this.facilitators.assertSessionFacilitator(user.id, sessionId);
    return this.sessions.markAttendance(sessionId, dto, { memberId: user.id });
  }

  @Get('teaching/assignments/:assignmentId/submissions')
  async facilitatorSubmissions(
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @CurrentUser() user: MemberAuth,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    await this.facilitators.assertAssignmentFacilitator(user.id, assignmentId);
    return this.assignments.getSubmissions(assignmentId, +page, +limit);
  }

  @Patch('teaching/submissions/:submissionId/grade')
  async facilitatorGrade(
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @Body() dto: GradeAssignmentDto,
    @CurrentUser() user: MemberAuth,
  ) {
    await this.facilitators.assertSubmissionFacilitator(user.id, submissionId);
    return this.assignments.gradeAsFacilitator(submissionId, dto, user.id);
  }

  @Get('teaching/:id/sessions')
  async facilitatorSessions(
    @Param('id', ParseUUIDPipe) classId: string,
    @CurrentUser() user: MemberAuth,
  ) {
    await this.facilitators.assertFacilitator(user.id, classId);
    return this.sessions.listSessions(classId);
  }

  @Post('teaching/:id/sessions')
  async facilitatorCreateSession(
    @Param('id', ParseUUIDPipe) classId: string,
    @Body() dto: CreateClassSessionDto,
    @CurrentUser() user: MemberAuth,
  ) {
    await this.facilitators.assertFacilitator(user.id, classId);
    return this.sessions.createSession(classId, dto);
  }

  @Post('teaching/:id/sessions/series')
  async facilitatorCreateSeries(
    @Param('id', ParseUUIDPipe) classId: string,
    @Body() dto: CreateClassSessionSeriesDto,
    @CurrentUser() user: MemberAuth,
  ) {
    await this.facilitators.assertFacilitator(user.id, classId);
    return this.sessions.createSeries(classId, dto);
  }

  @Get('teaching/:id/progress')
  async facilitatorProgress(
    @Param('id', ParseUUIDPipe) classId: string,
    @CurrentUser() user: MemberAuth,
  ) {
    await this.facilitators.assertFacilitator(user.id, classId);
    return this.progress.classProgress(classId);
  }

  @Get('teaching/:id/assignments')
  async facilitatorAssignments(
    @Param('id', ParseUUIDPipe) classId: string,
    @CurrentUser() user: MemberAuth,
  ) {
    await this.facilitators.assertFacilitator(user.id, classId);
    return this.assignments.getForClassWithCounts(classId);
  }

  // ─── Admin: join requests, sessions, certificates ──────────────────────────

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_READ)
  @Get('join-requests/pending-counts')
  pendingRequestCounts() {
    return this.joinRequests.pendingCounts();
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_WRITE)
  @Post('join-requests/:requestId/approve')
  approveJoinRequest(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.joinRequests.approve(requestId, admin.id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_WRITE)
  @Post('join-requests/:requestId/decline')
  declineJoinRequest(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: DeclineClassJoinRequestDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.joinRequests.decline(requestId, admin.id, dto.reason);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_WRITE)
  @Patch('sessions/:sessionId')
  updateSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: UpdateClassSessionScheduleDto,
  ) {
    return this.sessions.updateSession(sessionId, dto);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('sessions/:sessionId')
  deleteSession(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.sessions.deleteSession(sessionId);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_READ)
  @Get('sessions/:sessionId/roster')
  roster(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.sessions.getRoster(sessionId);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_WRITE)
  @Post('sessions/:sessionId/attendance')
  markAttendance(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: MarkClassAttendanceDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.sessions.markAttendance(sessionId, dto, { adminId: admin.id });
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_READ)
  @Get('enrollments/:enrollmentId/certificate')
  async certificatePdf(
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.certificates.pdf(enrollmentId);
    sendPdf(res, buffer, filename);
  }

  // ─── Per class (:id) ───────────────────────────────────────────────────────

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_READ)
  @Get(':id/sessions')
  listSessions(@Param('id', ParseUUIDPipe) classId: string) {
    return this.sessions.listSessions(classId);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_WRITE)
  @Post(':id/sessions')
  createSession(
    @Param('id', ParseUUIDPipe) classId: string,
    @Body() dto: CreateClassSessionDto,
  ) {
    return this.sessions.createSession(classId, dto);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_WRITE)
  @Post(':id/sessions/series')
  createSeries(
    @Param('id', ParseUUIDPipe) classId: string,
    @Body() dto: CreateClassSessionSeriesDto,
  ) {
    return this.sessions.createSeries(classId, dto);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_READ)
  @Get(':id/progress')
  classProgress(@Param('id', ParseUUIDPipe) classId: string) {
    return this.progress.classProgress(classId);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_READ)
  @Get(':id/join-requests')
  classJoinRequests(@Param('id', ParseUUIDPipe) classId: string) {
    return this.joinRequests.classRequests(classId);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CLASSES_WRITE)
  @Post(':id/certificates/issue-all')
  issueAllCertificates(
    @Param('id', ParseUUIDPipe) classId: string,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.certificates.issueAll(classId, user.id);
  }

  // Schedule for anyone; attendance and progress only for the caller's own enrollment. `join` saves the app a join-status call.
  @Get(':id/my-progress')
  async myProgress(
    @Param('id', ParseUUIDPipe) classId: string,
    @CurrentUser() user: MemberAuth,
  ) {
    const [status, sessions] = await Promise.all([
      this.joinRequests.joinStatus(classId, user.id),
      this.sessions.listSessions(classId, false),
    ]);
    const enrollmentId = status.enrollmentId;
    if (
      !enrollmentId ||
      status.enrollmentStatus === EnrollmentStatusEnum.CANCELLED
    )
      return {
        enrolled: false,
        schedule: sessions.map(({ attendance: _counts, ...s }) => s),
        progress: null,
        rules: null,
        join: status,
      };
    const [progress, schedule] = await Promise.all([
      this.progress.progressFor([classId], [enrollmentId]),
      this.sessions.scheduleForEnrollment(
        { id: enrollmentId, churchClass: { id: classId } },
        sessions,
      ),
    ]);
    const mine = progress.get(classId);
    return {
      enrolled: true,
      schedule,
      progress: mine?.people[0] ?? null,
      rules: mine?.rules ?? null,
      join: status,
    };
  }

  @Get(':id/join-status')
  joinStatus(
    @Param('id', ParseUUIDPipe) classId: string,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.joinRequests.joinStatus(classId, user.id);
  }

  @Post(':id/join-requests')
  requestToJoin(
    @Param('id', ParseUUIDPipe) classId: string,
    @Body() dto: CreateClassJoinRequestDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.joinRequests.request(classId, user.id, dto.message);
  }
}
