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
  Request,
  UseGuards,
} from '@nestjs/common';
import { DepartmentService } from '../service/department.service';
import { DepartmentCapability } from '../enums/department-capability.enum';
import { CreateDepartmentDto } from '../dto/create-department.dto';
import { UpdateDepartmentDto } from '../dto/update-department.dto';
import { AssignDepartmentHodDto } from '../dto/assign-department-hod.dto';
import { RemoveDepartmentHodDto } from '../dto/remove-department-hod.dto';
import { BulkAssignDepartmentDto } from '../dto/bulk-assign-department.dto';
import { RolesGuard } from '../../auth/guard/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';

@Controller('departments')
export class DepartmentController {
  constructor(private readonly departmentService: DepartmentService) {}

  @Get()
  async getAll() {
    return this.departmentService.getAll();
  }

  @Get('capabilities')
  getDepartmentCapabilities(): string[] {
    return Object.values(DepartmentCapability);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.DEPARTMENTS_READ)
  @Get('leads')
  async getAllLeads() {
    return this.departmentService.getAllLeads();
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.DEPARTMENTS_READ)
  @Get('leads/:id')
  async getDepartmentLeads(@Param('id', ParseUUIDPipe) id: string) {
    return this.departmentService.getDepartmentLeads(id);
  }

  @Get(':id')
  async getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.departmentService.getOne(id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.DEPARTMENTS_WRITE)
  @Post()
  async create(
    @Body() dto: CreateDepartmentDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.departmentService.create(dto, user.id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.DEPARTMENTS_WRITE)
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepartmentDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.departmentService.update(id, dto, user.id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.DEPARTMENTS_WRITE)
  @Delete(':id')
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: MemberAuth,
  ) {
    await this.departmentService.delete(id, user.id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.DEPARTMENTS_WRITE)
  @HttpCode(HttpStatus.OK)
  @Post('assign-lead')
  async assignLead(
    @Body() dto: AssignDepartmentHodDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.departmentService.assignLead(dto, user.id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.DEPARTMENTS_WRITE)
  @HttpCode(HttpStatus.OK)
  @Post('remove-lead')
  async removeLead(
    @Body() dto: RemoveDepartmentHodDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.departmentService.removeLead(dto, user.id);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.DEPARTMENTS_READ)
  @Get(':id/workers')
  async getWorkersByDepartment(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.departmentService.getWorkersByDepartment(id, +page, +limit);
  }

  @UseGuards(AdminGuard)
  @RequiresPermission(AdminPermission.DEPARTMENTS_WRITE)
  @HttpCode(HttpStatus.OK)
  @Post(':id/bulk-assign')
  async bulkAssignDepartment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BulkAssignDepartmentDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.departmentService.bulkAssignDepartment(id, dto, user.id);
  }

  @UseGuards(RolesGuard)
  @Roles(MemberRoleEnum.WORKER)
  @Get('my/summary')
  async getDepartmentSummary(@Request() req: any) {
    return this.departmentService.getDepartmentSummary(req.user);
  }
}
