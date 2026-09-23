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
  UseGuards,
} from '@nestjs/common';
import { AdminService } from '../service/admin.service';
import { GrantAdminDto, UpdateAdminUserDto } from '../dto/admin-user.dto';
import { AdminGuard } from '../guard/admin.guard';
import { RequiresPermission } from '../decorator/requires-permission.decorator';
import { AdminPermission } from '../enum/admin-permission.enum';
import { CurrentAdmin } from '../decorator/current-admin.decorator';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { Admin } from '../entity/admin.entity';
import { MemberAuth } from '../../auth/interface/auth.interface';

@UseGuards(AdminGuard)
@Controller('admin/users')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @RequiresPermission(AdminPermission.ADMIN_READ)
  @Get()
  getAll() {
    return this.adminService.getAll();
  }

  @Get('me')
  getMe(@CurrentAdmin() admin: Admin) {
    return this.adminService.getMyProfile(admin.id);
  }

  @RequiresPermission(AdminPermission.ADMIN_READ)
  @Get(':id')
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.findById(id);
  }

  @RequiresPermission(AdminPermission.ADMIN_WRITE)
  @Post()
  grant(@Body() dto: GrantAdminDto, @CurrentUser() user: MemberAuth) {
    return this.adminService.grant(dto, user.id);
  }

  @RequiresPermission(AdminPermission.ADMIN_WRITE)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminUserDto,
    @CurrentUser() user: MemberAuth,
  ) {
    return this.adminService.update(id, dto, user.id);
  }

  @RequiresPermission(AdminPermission.ADMIN_WRITE)
  @Post(':id/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: MemberAuth,
  ) {
    await this.adminService.revoke(id, user.id);
  }
}
