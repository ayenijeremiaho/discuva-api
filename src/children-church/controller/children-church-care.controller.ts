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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { LimitedFileInterceptor } from '../../utility/interceptors/limited-file.interceptor';
import { ChildCareService } from '../service/child-care.service';
import { ChildCheckInNoteService } from '../service/child-checkin-note.service';
import { ChildrenChurchDashboardService } from '../service/children-church-dashboard.service';
import {
  ChildrenChurchAdminService,
  ParentLinkFilter,
} from '../service/children-church-admin.service';
import {
  AddCheckInNoteDto,
  LinkGuardianDto,
  ParentReplyDto,
  SetAwayDto,
  UpdateChildCareDto,
} from '../dto/child-care.dto';
import { CreateGuardianDto } from '../dto/create-guardian.dto';
import { SetStayingDto } from '../dto/child-check-in.dto';
import {
  CreateChildClassGroupDto,
  SetRoomDutyDto,
  UpdateChildClassGroupDto,
} from '../dto/create-class-group.dto';
import {
  CreateChildAgeGroupDto,
  UpdateChildAgeGroupDto,
} from '../dto/create-age-group.dto';
import { ChildRoomService } from '../service/child-room.service';
import { ChildrenChurchService } from '../service/children-church.service';

const CHILD_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

@RequiresModule('children_church')
@UseGuards(ModuleEnabledGuard)
@Controller('children-church')
export class ChildrenChurchCareController {
  constructor(
    private readonly care: ChildCareService,
    private readonly notes: ChildCheckInNoteService,
    private readonly dashboard: ChildrenChurchDashboardService,
    private readonly admin: ChildrenChurchAdminService,
    private readonly rooms: ChildRoomService,
    private readonly children: ChildrenChurchService,
  ) {}

  // ─── Parents and guardians ────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('children/mine/:id')
  view(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.care.view(req.user, id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('children/mine/:id')
  update(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChildCareDto,
  ) {
    return this.care.update(req.user, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('children/mine/:id/photo')
  @UseInterceptors(LimitedFileInterceptor('file', CHILD_PHOTO_MAX_BYTES))
  photo(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.care.uploadPhoto(req.user, id, file);
  }

  @UseGuards(JwtAuthGuard)
  @Put('children/mine/:id/away')
  setAway(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetAwayDto,
  ) {
    return this.care.setAway(req.user, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('children/mine/:id/away')
  clearAway(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.care.clearAway(req.user, id);
  }

  @UseGuards(JwtAuthGuard)
  @Put('children/mine/:id/staying')
  setMyChildStaying(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetStayingDto,
  ) {
    return this.care.setStaying(req.user, id, dto.staying);
  }

  @UseGuards(JwtAuthGuard)
  @Post('children/mine/:id/notes')
  reply(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ParentReplyDto,
  ) {
    return this.care.reply(req.user, id, dto);
  }

  // ─── Team ─────────────────────────────────────────────────────────────────

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Get('roster')
  async roster(
    @Request() req: any,
    @Query('search') search?: string,
    @Query('link') link?: ParentLinkFilter,
    @Query('page') page = 1,
  ) {
    await this.notes.requireTeam(req.user);
    return this.admin.list({
      search,
      link: link === 'linked' || link === 'unlinked' ? link : undefined,
      page: +page || 1,
      limit: 20,
    });
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Get('checkin/:id/detail')
  detail(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.notes.detail(req.user, id);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Post('checkin/:id/notes')
  addNote(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddCheckInNoteDto,
  ) {
    return this.notes.add(req.user, id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Patch('checkin/:id/staying')
  async setStaying(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetStayingDto,
  ) {
    await this.notes.requireTeam(req.user);
    return this.children.setStaying(id, dto.staying);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Get('duty')
  myDuty(@Request() req: any) {
    return this.rooms.myDuty(req.user);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Put('duty')
  setDuty(@Request() req: any, @Body() dto: SetRoomDutyDto) {
    return this.rooms.setDuty(req.user, dto.classGroupId ?? null);
  }

  // ─── HOD and deputy ───────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('lead')
  async lead(@Request() req: any) {
    return { isLead: await this.dashboard.isLead(req.user.id) };
  }

  @UseGuards(JwtAuthGuard)
  @Get('dashboard/today')
  today(@Request() req: any) {
    return this.dashboard.today(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('setup')
  setup(@Request() req: any) {
    return this.rooms.setup(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Post('setup/age-groups')
  addGroup(@Request() req: any, @Body() dto: CreateChildAgeGroupDto) {
    return this.rooms.addGroup(req.user, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('setup/age-groups/:id')
  updateGroup(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChildAgeGroupDto,
  ) {
    return this.rooms.updateGroup(req.user, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('setup/age-groups/:id')
  deleteGroup(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.rooms.deleteGroup(req.user, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('setup/rooms')
  addRoom(@Request() req: any, @Body() dto: CreateChildClassGroupDto) {
    return this.rooms.addRoom(req.user, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('setup/rooms/:id')
  updateRoom(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChildClassGroupDto,
  ) {
    return this.rooms.updateRoom(req.user, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('setup/rooms/:id')
  deleteRoom(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.rooms.deleteRoom(req.user, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('setup/regroup')
  regroup(@Request() req: any) {
    return this.rooms.regroup(req.user);
  }

  // ─── Admin portal ─────────────────────────────────────────────────────────

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CHILDREN_CHURCH_READ)
  @Get('admin/children')
  list(
    @Query('search') search?: string,
    @Query('classGroupId') classGroupId?: string,
    @Query('link') link?: ParentLinkFilter,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.admin.list({
      search,
      classGroupId,
      link: link === 'linked' || link === 'unlinked' ? link : undefined,
      page: +page || 1,
      limit: +limit || 20,
    });
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CHILDREN_CHURCH_READ)
  @Get('admin/teachers')
  teachers() {
    return this.admin.teachers();
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CHILDREN_CHURCH_WRITE)
  @Get('admin/members/search')
  searchMembers(@Query('q') q = '') {
    return this.admin.searchMembers(q);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CHILDREN_CHURCH_READ)
  @Get('admin/children/:id')
  adminDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.detail(id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CHILDREN_CHURCH_WRITE)
  @Post('admin/children/:id/guardians')
  adminAddGuardian(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateGuardianDto,
  ) {
    return this.admin.addGuardian(id, dto);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CHILDREN_CHURCH_WRITE)
  @Patch('admin/guardians/:id')
  adminLinkGuardian(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkGuardianDto,
  ) {
    return this.admin.linkGuardian(id, dto.memberId ?? null);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CHILDREN_CHURCH_WRITE)
  @Delete('admin/guardians/:id')
  adminRemoveGuardian(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.removeGuardian(id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CHILDREN_CHURCH_WRITE)
  @Patch('admin/children/:id/notes')
  adminNotes(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { specialNotes?: string | null },
  ) {
    return this.admin.updateNotes(id, body.specialNotes ?? null);
  }
}
