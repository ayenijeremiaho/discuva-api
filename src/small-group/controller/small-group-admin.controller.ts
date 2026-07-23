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
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { SmallGroupService } from '../service/small-group.service';
import {
  CreateSmallGroupDto,
  UpdateSmallGroupDto,
} from '../dto/small-group.dto';

@Controller('admin/small-groups')
@UseGuards(AdminGuard)
export class SmallGroupAdminController {
  constructor(private readonly smallGroupService: SmallGroupService) {}

  @Post()
  @RequiresPermission(AdminPermission.SMALL_GROUP_WRITE)
  create(@Body() dto: CreateSmallGroupDto, @CurrentAdmin() admin: Admin) {
    return this.smallGroupService.create(dto, admin);
  }

  @Get()
  @RequiresPermission(AdminPermission.SMALL_GROUP_READ)
  list(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.smallGroupService.list(page ? +page : 1, limit ? +limit : 20);
  }

  @Get(':id')
  @RequiresPermission(AdminPermission.SMALL_GROUP_READ)
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.smallGroupService.getOne(id);
  }

  @Patch(':id')
  @RequiresPermission(AdminPermission.SMALL_GROUP_WRITE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSmallGroupDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.smallGroupService.update(id, dto, admin);
  }

  @Delete(':id')
  @RequiresPermission(AdminPermission.SMALL_GROUP_WRITE)
  delete(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() admin: Admin) {
    return this.smallGroupService.delete(id, admin);
  }

  @Get(':id/members')
  @RequiresPermission(AdminPermission.SMALL_GROUP_READ)
  getRoster(@Param('id', ParseUUIDPipe) id: string) {
    return this.smallGroupService.getRoster(id);
  }

  @Delete(':id/members/:memberId')
  @RequiresPermission(AdminPermission.SMALL_GROUP_WRITE)
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.smallGroupService.removeMember(id, memberId, admin);
  }

  @Get(':id/attendance')
  @RequiresPermission(AdminPermission.SMALL_GROUP_READ)
  getAttendanceHistory(@Param('id', ParseUUIDPipe) id: string) {
    return this.smallGroupService.getAttendanceHistory(id);
  }
}
