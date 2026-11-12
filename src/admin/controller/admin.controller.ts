import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { OpenToOverseers } from '../../network-overseer/open-to-overseers.decorator';
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
  Put,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from '../service/admin.service';
import {
  GrantAdminDto,
  UpdateAdminUserDto,
  UpdateFavouritePagesDto,
} from '../dto/admin-user.dto';
import { AdminGuard } from '../guard/admin.guard';
import { RequiresPermission } from '../decorator/requires-permission.decorator';
import { AdminPermission } from '../enum/admin-permission.enum';
import { CurrentAdmin } from '../decorator/current-admin.decorator';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { Admin } from '../entity/admin.entity';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { UpdateAppearanceModeDto } from '../../member/dto/update-appearance-mode.dto';

@UseGuards(AdminGuard)
@Controller('admin/users')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  @RequiresPermission(AdminPermission.ADMIN_READ)
  @Get()
  getAll() {
    return this.adminService.getAll();
  }

  @OpenToOverseers()
  @Get('me')
  async getMe(@CurrentAdmin() admin: Admin & { overseer?: boolean }) {
    if (admin.overseer) return admin;
    const me = await this.adminService.getMyProfile(admin.id);
    // A closed branch is read-only, so its admins' portal shows read permissions only.
    const closed = await this.tenantRepo.exists({
      where: { id: this.cls.get('tenantId'), closedAt: Not(IsNull()) },
    });
    if (closed && me.adminRole) {
      me.adminRole = {
        ...me.adminRole,
        permissions: me.adminRole.permissions.filter((p) =>
          p.endsWith(':read'),
        ),
      };
    }
    return me;
  }

  @Patch('me/appearance')
  updateMyAppearance(
    @CurrentAdmin() admin: Admin,
    @Body() dto: UpdateAppearanceModeDto,
  ) {
    return this.adminService.updateMyAppearanceMode(
      admin.id,
      dto.appearanceMode,
      dto.useChurchTheme,
    );
  }

  @Put('me/favourite-pages')
  updateFavouritePages(
    @CurrentAdmin() admin: Admin,
    @Body() dto: UpdateFavouritePagesDto,
  ) {
    return this.adminService.updateFavouritePages(admin.id, dto.pages);
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

  // Another admin only: for someone who has lost their app and their backup codes.
  @RequiresPermission(AdminPermission.ADMIN_WRITE)
  @Post(':id/reset-2fa')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetTwoFactor(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: MemberAuth,
  ) {
    await this.adminService.resetTwoFactor(id, user.id);
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
