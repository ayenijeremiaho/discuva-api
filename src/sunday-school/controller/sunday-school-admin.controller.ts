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
import { SundaySchoolService } from '../service/sunday-school.service';
import {
  CreateSundaySchoolClassDto,
  UpdateSundaySchoolClassDto,
} from '../dto/create-sunday-school-class.dto';
import { AssignSundaySchoolMemberDto } from '../dto/assign-sunday-school-member.dto';
import {
  CreateSundaySchoolSessionDto,
  OpenSelfMarkDto,
} from '../dto/create-sunday-school-session.dto';
import { BulkMarkAttendanceDto } from '../dto/bulk-mark-attendance.dto';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';

@RequiresModule('sunday_school')
@UseGuards(AdminGuard, ModuleEnabledGuard)
@Controller('admin/sunday-school')
export class SundaySchoolAdminController {
  constructor(private readonly sundaySchoolService: SundaySchoolService) {}

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
  @Post('sessions/:id/bulk-mark')
  bulkMarkAttendance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BulkMarkAttendanceDto,
  ) {
    return this.sundaySchoolService.adminBulkMarkAttendance(id, dto);
  }
}
