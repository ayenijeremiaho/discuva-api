import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AttendanceService } from '../service/attendance.service';
import { CheckInDto } from '../dto/check-in.dto';
import { CorrectAttendanceDto } from '../dto/attendance.dto';
import { OnlineConfirmDto } from '../../follow-up/dto/online-confirm.dto';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import {
  AdminAttendanceHistoryQueryDto,
  AttendanceHistoryQueryDto,
} from '../dto/attendance-history-query.dto';

@Controller('attendances')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('checkin')
  async checkin(@Request() req: any, @Body() dto: CheckInDto) {
    return this.attendanceService.checkin(req.user, dto);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('online-confirm')
  async confirmOnlineAttendance(
    @Request() req: any,
    @Body() dto: OnlineConfirmDto,
  ) {
    return this.attendanceService.confirmOnlineAttendance(
      req.user.id,
      dto.eventId,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('my-summary')
  async getMySummary(@Request() req: any) {
    return this.attendanceService.getMyAttendanceSummary(
      req.user.id,
      req.user.role,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('my-history')
  async getMyHistory(
    @Request() req: any,
    @Query() query: AttendanceHistoryQueryDto,
  ) {
    const { page = 1, limit = 10, status, dateFrom, dateTo } = query;
    return this.attendanceService.getMyHistory(
      req.user,
      page,
      limit,
      status,
      dateFrom,
      dateTo,
    );
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.ATTENDANCE_READ)
  @Get('history')
  async getAllHistory(@Query() query: AdminAttendanceHistoryQueryDto) {
    const {
      page = 1,
      limit = 10,
      memberId,
      slotId,
      status,
      dateFrom,
      dateTo,
      search,
    } = query;
    return this.attendanceService.getAllHistory(
      page,
      limit,
      memberId,
      slotId,
      status,
      dateFrom,
      dateTo,
      search,
    );
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Get('history/department')
  async getDepartmentHistory(
    @Request() req: any,
    @Query('slotId', ParseUUIDPipe) slotId: string,
  ) {
    return this.attendanceService.getDepartmentHistory(req.user, slotId);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.ATTENDANCE_READ)
  @Get('summary/slot/:slotId')
  async getSlotSummary(@Param('slotId', ParseUUIDPipe) slotId: string) {
    return this.attendanceService.getSlotSummary(slotId);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.ATTENDANCE_READ)
  @Get('leaderboard')
  async getLeaderboard(
    @Query('daysAgo') daysAgo = 7,
    @Query('limit') limit = 10,
  ) {
    return this.attendanceService.getWorkerLeaderboard(+daysAgo, +limit);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Get('department/event/:eventId')
  async getDepartmentEventAttendance(
    @Request() req: any,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.attendanceService.getDepartmentEventAttendance(
      req.user,
      eventId,
    );
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.ATTENDANCE_READ)
  @Get('at-risk')
  async getAtRiskMembers(
    @Query('minAbsences') minAbsences = 3,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.attendanceService.getAtRiskMembers(
      +minAbsences,
      from,
      to,
      +page,
      +limit,
    );
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.ATTENDANCE_WRITE)
  @Patch(':id/correct')
  async correctAttendance(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CorrectAttendanceDto,
  ) {
    return this.attendanceService.correctAttendance(
      id,
      dto.status,
      req.user.id,
    );
  }
}
