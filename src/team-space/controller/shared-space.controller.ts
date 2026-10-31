import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { SaveSharedSpaceDto } from '../dto/team-space.dto';
import { SharedSpaceService } from '../service/shared-space.service';

@RequiresModule('team_spaces')
@UseGuards(AdminGuard, ModuleEnabledGuard)
@Controller('admin/team-spaces/shared')
export class SharedSpaceController {
  constructor(private readonly shared: SharedSpaceService) {}

  @Get()
  @RequiresPermission(AdminPermission.DEPARTMENTS_READ)
  list() {
    return this.shared.list();
  }

  @Post()
  @RequiresPermission(AdminPermission.DEPARTMENTS_WRITE)
  create(@Body() dto: SaveSharedSpaceDto, @CurrentAdmin() admin: Admin) {
    return this.shared.create(dto, admin.member?.id);
  }

  @Patch(':id')
  @RequiresPermission(AdminPermission.DEPARTMENTS_WRITE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveSharedSpaceDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.shared.update(id, dto, admin.member?.id);
  }

  @Post(':id/archive')
  @RequiresPermission(AdminPermission.DEPARTMENTS_WRITE)
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.shared.setArchived(id, true, admin.member?.id);
  }

  @Post(':id/restore')
  @RequiresPermission(AdminPermission.DEPARTMENTS_WRITE)
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.shared.setArchived(id, false, admin.member?.id);
  }
}
