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
  UseGuards,
} from '@nestjs/common';
import { GroupService } from '../service/group.service';
import { CreateGroupDto, UpdateGroupDto } from '../dto/create-group.dto';
import {
  AddFirstTimersToGroupDto,
  AddGroupMemberDto,
  AddPhoneGroupMembersDto,
  BulkAddGroupMembersDto,
  BulkRemoveGroupEntriesDto,
  BulkRemoveGroupMembersDto,
} from '../dto/group-member.dto';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';

@UseGuards(AdminGuard)
@Controller('groups')
export class GroupController {
  constructor(private readonly groupService: GroupService) {}

  @RequiresPermission(AdminPermission.GROUPS_READ)
  @Get()
  getAll() {
    return this.groupService.getAll();
  }

  // Gated on ANNOUNCEMENTS_WRITE rather than GROUPS_READ: picking a group to
  // target an announcement is a component of the announcement feature, not a
  // separate group-management capability, so it shouldn't require a second
  // permission grant. Must be registered before ':id' or it'd be swallowed
  // as an id param.
  @RequiresPermission(AdminPermission.ANNOUNCEMENTS_WRITE)
  @Get('lookup')
  getLookup() {
    return this.groupService.getLookup();
  }

  @RequiresPermission(AdminPermission.GROUPS_READ)
  @Get(':id')
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.groupService.getById(id);
  }

  @RequiresPermission(AdminPermission.GROUPS_WRITE)
  @Post()
  create(@Body() dto: CreateGroupDto, @CurrentUser() user: MemberAuth) {
    return this.groupService.create(dto, user.id);
  }

  @RequiresPermission(AdminPermission.GROUPS_WRITE)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGroupDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.groupService.update(id, dto, user.id);
  }

  @RequiresPermission(AdminPermission.GROUPS_WRITE)
  @Delete(':id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.groupService.delete(id, user.id);
  }

  @RequiresPermission(AdminPermission.GROUPS_READ)
  @Get(':id/members')
  getMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.groupService.getMembers(id, Number(page), Number(limit));
  }

  @RequiresPermission(AdminPermission.GROUPS_WRITE)
  @Post(':id/members')
  addMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddGroupMemberDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.groupService.addMember(id, dto, user.id);
  }

  @RequiresPermission(AdminPermission.GROUPS_WRITE)
  @HttpCode(HttpStatus.OK)
  @Post(':id/members/bulk-add')
  bulkAddMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BulkAddGroupMembersDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.groupService.bulkAddMembers(id, dto, user.id);
  }

  @RequiresPermission(AdminPermission.GROUPS_WRITE)
  @Delete(':id/members/:memberId')
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.groupService.removeMember(id, memberId, user.id);
  }

  @RequiresPermission(AdminPermission.GROUPS_WRITE)
  @HttpCode(HttpStatus.OK)
  @Post(':id/members/bulk-remove')
  bulkRemoveMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BulkRemoveGroupMembersDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.groupService.bulkRemoveMembers(id, dto, user.id);
  }

  @RequiresPermission(AdminPermission.GROUPS_WRITE)
  @Post(':id/members/phone')
  addPhoneEntries(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddPhoneGroupMembersDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.groupService.addPhoneEntries(id, dto, user.id);
  }

  @RequiresPermission(AdminPermission.GROUPS_WRITE)
  @Post(':id/members/first-timers')
  addFirstTimersToGroup(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddFirstTimersToGroupDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.groupService.addFirstTimersToGroup(id, dto, user.id);
  }

  @RequiresPermission(AdminPermission.GROUPS_WRITE)
  @Delete(':id/entries/:entryId')
  removeEntry(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.groupService.removeEntry(id, entryId, user.id);
  }

  @RequiresPermission(AdminPermission.GROUPS_WRITE)
  @HttpCode(HttpStatus.OK)
  @Post(':id/entries/bulk-remove')
  bulkRemoveEntries(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BulkRemoveGroupEntriesDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.groupService.bulkRemoveEntries(id, dto, user.id);
  }
}
