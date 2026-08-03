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
  UseGuards,
} from '@nestjs/common';
import { Public } from '../../auth/decorator/public.decorator';
import { PlatformAdminGuard } from '../guard/platform-admin.guard';
import { RequiresPlatformPermission } from '../decorator/requires-platform-permission.decorator';
import { PlatformAdminPermission } from '../enum/platform-admin-permission.enum';
import { PlatformAdminRoleService } from '../service/platform-admin-role.service';
import {
  CreatePlatformAdminRoleDto,
  UpdatePlatformAdminRoleDto,
} from '../dto/platform-admin-role.dto';

// @Public() at class level for the same reason as every other /platform/*
// controller — the global JwtAuthGuard would otherwise 401 a platform admin
// (who never has a tenant JWT) before PlatformAdminGuard gets a chance to.
@Public()
@UseGuards(PlatformAdminGuard)
@Controller('platform/admin-roles')
export class PlatformAdminRoleController {
  constructor(private readonly roleService: PlatformAdminRoleService) {}

  @RequiresPlatformPermission(PlatformAdminPermission.PLATFORM_ADMINS_READ)
  @Get()
  getAll() {
    return this.roleService.getAll();
  }

  @RequiresPlatformPermission(PlatformAdminPermission.PLATFORM_ADMINS_READ)
  @Get(':id')
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.roleService.getById(id);
  }

  @RequiresPlatformPermission(PlatformAdminPermission.PLATFORM_ADMINS_WRITE)
  @Post()
  create(@Body() dto: CreatePlatformAdminRoleDto) {
    return this.roleService.create(dto);
  }

  @RequiresPlatformPermission(PlatformAdminPermission.PLATFORM_ADMINS_WRITE)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlatformAdminRoleDto,
  ) {
    return this.roleService.update(id, dto);
  }

  @RequiresPlatformPermission(PlatformAdminPermission.PLATFORM_ADMINS_WRITE)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    await this.roleService.delete(id);
  }
}
