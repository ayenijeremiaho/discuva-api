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
  Request,
  UseGuards,
} from '@nestjs/common';
import { SundaySchoolService } from '../service/sunday-school.service';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
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
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';

@RequiresModule('sunday_school')
@UseGuards(ModuleEnabledGuard)
@Controller('sunday-school')
export class SundaySchoolController {
  constructor(private readonly sundaySchoolService: SundaySchoolService) {}

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Post('classes')
  async createClass(
    @Request() req: any,
    @Body() dto: CreateSundaySchoolClassDto,
  ) {
    return this.sundaySchoolService.createClass(req.user, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Patch('classes/:id')
  async updateClass(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSundaySchoolClassDto,
  ) {
    return this.sundaySchoolService.updateClass(req.user, id, dto);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.SUNDAY_SCHOOL_WRITE)
  @Delete('classes/:id')
  async deleteClass(@Param('id', ParseUUIDPipe) id: string) {
    return this.sundaySchoolService.deleteClass(id);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Get('classes')
  async getAllClasses(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.sundaySchoolService.getAllClasses(+page, +limit);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Get('classes/:id')
  async getClass(@Param('id', ParseUUIDPipe) id: string) {
    return this.sundaySchoolService.getClass(id);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Post('classes/:id/members')
  async assignMember(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) classId: string,
    @Body() dto: AssignSundaySchoolMemberDto,
  ) {
    return this.sundaySchoolService.assignMember(req.user, classId, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Delete('classes/:id/members/:memberId')
  async removeMember(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) classId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    return this.sundaySchoolService.removeMember(req.user, classId, memberId);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Get('classes/:id/members')
  async getClassMembers(
    @Param('id', ParseUUIDPipe) classId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.sundaySchoolService.getClassMembers(classId, +page, +limit);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Get('sessions')
  async getSessionsForClass(
    @Request() req: any,
    @Query('classId', ParseUUIDPipe) classId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.sundaySchoolService.getSessionsForClass(
      req.user,
      classId,
      +page,
      +limit,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('attendance/me')
  async getMyAttendanceHistory(
    @Request() req: any,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.sundaySchoolService.getMyAttendanceHistory(
      req.user,
      +page,
      +limit,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('sessions/open')
  async getOpenSessions(@Request() req: any) {
    return this.sundaySchoolService.getOpenSessionsForMember(req.user);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Get('sessions/:id')
  async getSession(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sundaySchoolService.getSession(req.user, id);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Delete('sessions/:id')
  async deleteSession(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sundaySchoolService.deleteSession(req.user, id);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Post('sessions')
  async createSession(
    @Request() req: any,
    @Body() dto: CreateSundaySchoolSessionDto,
  ) {
    return this.sundaySchoolService.createSession(req.user, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Patch('sessions/:id/open')
  async openSelfMark(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OpenSelfMarkDto,
  ) {
    return this.sundaySchoolService.openSelfMark(
      req.user,
      id,
      dto.closesInMinutes,
    );
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Patch('sessions/:id/close')
  async closeSelfMark(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sundaySchoolService.closeSelfMark(req.user, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('sessions/:id/checkin')
  async selfMarkPresent(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sundaySchoolService.selfMarkPresent(req.user, id);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Post('sessions/:id/bulk-mark')
  async bulkMarkAttendance(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BulkMarkAttendanceDto,
  ) {
    return this.sundaySchoolService.bulkMarkAttendance(req.user, id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Get('sessions/:id/roster')
  async getSessionRoster(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sundaySchoolService.getSessionRoster(req.user, id);
  }
}
