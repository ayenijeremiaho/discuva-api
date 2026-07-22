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
import { ChildrenChurchService } from '../service/children-church.service';
import { RolesGuard } from '../../auth/guard/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import {
  CreateChildAgeGroupDto,
  UpdateChildAgeGroupDto,
} from '../dto/create-age-group.dto';
import {
  CreateChildClassGroupDto,
  UpdateChildClassGroupDto,
} from '../dto/create-class-group.dto';
import {
  CreateChildProfileDto,
  UpdateChildProfileDto,
} from '../dto/create-child-profile.dto';
import { CreateGuardianDto } from '../dto/create-guardian.dto';
import { ChildCheckInDto } from '../dto/child-check-in.dto';
import { ChildCheckOutDto } from '../dto/child-check-out.dto';
import { FlagCheckInDto } from '../dto/flag-check-in.dto';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';

@RequiresModule('children_church')
@UseGuards(ModuleEnabledGuard)
@Controller('children-church')
export class ChildrenChurchController {
  constructor(private readonly childrenChurchService: ChildrenChurchService) {}

  // ─── Age Groups ───────────────────────────────────────────────────────────

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CHILDREN_CHURCH_WRITE)
  @Post('age-groups')
  async createAgeGroup(@Body() dto: CreateChildAgeGroupDto) {
    return this.childrenChurchService.createAgeGroup(dto);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CHILDREN_CHURCH_WRITE)
  @Patch('age-groups/:id')
  async updateAgeGroup(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChildAgeGroupDto,
  ) {
    return this.childrenChurchService.updateAgeGroup(id, dto);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CHILDREN_CHURCH_WRITE)
  @Delete('age-groups/:id')
  async deleteAgeGroup(@Param('id', ParseUUIDPipe) id: string) {
    return this.childrenChurchService.deleteAgeGroup(id);
  }

  @Get('age-groups')
  async getAllAgeGroups() {
    return this.childrenChurchService.getAllAgeGroups();
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CHILDREN_CHURCH_WRITE)
  @Post('age-groups/recompute')
  async batchRecomputeAgeGroups() {
    return this.childrenChurchService.batchRecomputeAgeGroups();
  }

  // ─── Class Groups ─────────────────────────────────────────────────────────

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CHILDREN_CHURCH_WRITE)
  @Post('class-groups')
  async createClassGroup(@Body() dto: CreateChildClassGroupDto) {
    return this.childrenChurchService.createClassGroup(dto);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CHILDREN_CHURCH_WRITE)
  @Patch('class-groups/:id')
  async updateClassGroup(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChildClassGroupDto,
  ) {
    return this.childrenChurchService.updateClassGroup(id, dto);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CHILDREN_CHURCH_WRITE)
  @Delete('class-groups/:id')
  async deleteClassGroup(@Param('id', ParseUUIDPipe) id: string) {
    return this.childrenChurchService.deleteClassGroup(id);
  }

  @Get('class-groups')
  async getClassGroupsByAgeGroup(@Query('ageGroupId') ageGroupId: string) {
    return this.childrenChurchService.getClassGroupsByAgeGroup(ageGroupId);
  }

  // ─── Children ─────────────────────────────────────────────────────────────

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Post('children')
  async registerChild(@Request() req: any, @Body() dto: CreateChildProfileDto) {
    return this.childrenChurchService.registerChild(req.user, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Patch('children/:id')
  async updateChild(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChildProfileDto,
  ) {
    return this.childrenChurchService.updateChild(req.user, id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Get('children/:id')
  async getChild(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.childrenChurchService.getChild(req.user, id);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Get('children')
  async searchChildren(
    @Request() req: any,
    @Query('name') name?: string,
    @Query('classGroupId') classGroupId?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.childrenChurchService.searchChildren(
      req.user,
      name,
      +page,
      +limit,
      classGroupId,
    );
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Get('children/:id/checkin-history')
  async getChildCheckInHistory(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.childrenChurchService.getChildCheckInHistory(
      req.user,
      id,
      +page,
      +limit,
    );
  }

  // ─── Guardians ────────────────────────────────────────────────────────────

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Post('children/:id/guardians')
  async addGuardian(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) childId: string,
    @Body() dto: CreateGuardianDto,
  ) {
    return this.childrenChurchService.addGuardian(req.user, childId, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Get('children/:id/guardians')
  async getChildGuardians(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) childId: string,
  ) {
    return this.childrenChurchService.getChildGuardians(req.user, childId);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Delete('guardians/:id')
  async removeGuardian(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.childrenChurchService.removeGuardian(req.user, id);
  }

  // ─── Check-In / Check-Out ─────────────────────────────────────────────────

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Post('checkin')
  async checkIn(@Request() req: any, @Body() dto: ChildCheckInDto) {
    return this.childrenChurchService.checkIn(req.user, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Get('checkin/verify/:code')
  async verifyPickupCode(@Request() req: any, @Param('code') code: string) {
    return this.childrenChurchService.verifyPickupCode(req.user, code);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Post('checkout')
  async checkOut(@Request() req: any, @Body() dto: ChildCheckOutDto) {
    return this.childrenChurchService.checkOut(req.user, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Patch('checkin/:id/flag')
  async flagCheckIn(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FlagCheckInDto,
  ) {
    return this.childrenChurchService.flagCheckIn(req.user, id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Get('checkin/active')
  async getActiveCheckIns(
    @Request() req: any,
    @Query('classGroupId') classGroupId?: string,
  ) {
    return this.childrenChurchService.getActiveCheckIns(req.user, classGroupId);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CHILDREN_CHURCH_READ)
  @Get('admin/checkin/active')
  async getActiveCheckInsAdmin(@Query('classGroupId') classGroupId?: string) {
    return this.childrenChurchService.getActiveCheckInsAdmin(classGroupId);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CHILDREN_CHURCH_READ)
  @Get('admin/checkin/history')
  async getCheckInHistoryAdmin(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('classGroupId') classGroupId?: string,
    @Query('status') status?: string,
    @Query('slotId') slotId?: string,
  ) {
    return this.childrenChurchService.getCheckInHistoryAdmin(
      +page,
      +limit,
      classGroupId,
      status as any,
      slotId,
    );
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.CHILDREN_CHURCH_READ)
  @Get('checkin/slot/:slotId')
  async getCheckInsBySlot(
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.childrenChurchService.getCheckInsBySlot(slotId, +page, +limit);
  }
}
