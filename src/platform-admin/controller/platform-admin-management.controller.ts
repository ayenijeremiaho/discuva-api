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
import { Public } from '../../auth/decorator/public.decorator';
import { PlatformAdminGuard } from '../guard/platform-admin.guard';
import { RequiresPlatformPermission } from '../decorator/requires-platform-permission.decorator';
import { PlatformAdminPermission } from '../enum/platform-admin-permission.enum';
import { PlatformAdminManagementService } from '../service/platform-admin-management.service';
import {
  CreatePlatformAdminDto,
  UpdatePlatformAdminDto,
} from '../dto/platform-admin-user.dto';
import { CurrentPlatformAdmin } from '../decorator/current-platform-admin.decorator';
import { PlatformAdminAuth } from '../interface/platform-admin-auth.interface';

// Onboarding/management for platform admin *users* themselves — see
// PlatformAdminManagementService's own comment for why this is a separate
// service/controller from auth (login) and roles.
@Public()
@UseGuards(PlatformAdminGuard)
@Controller('platform/admins')
export class PlatformAdminManagementController {
  constructor(
    private readonly managementService: PlatformAdminManagementService,
  ) {}

  @RequiresPlatformPermission(PlatformAdminPermission.PLATFORM_ADMINS_READ)
  @Get()
  getAll() {
    return this.managementService.getAll();
  }

  // No permission requirement beyond a valid platform-admin token — every
  // platform admin can see their own record and permissions, same as
  // tenant-side admin/users/me.
  @Get('me')
  getMe(@CurrentPlatformAdmin() admin: PlatformAdminAuth) {
    return this.managementService.getById(admin.id);
  }

  @RequiresPlatformPermission(PlatformAdminPermission.PLATFORM_ADMINS_READ)
  @Get(':id')
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.managementService.getById(id);
  }

  @RequiresPlatformPermission(PlatformAdminPermission.PLATFORM_ADMINS_WRITE)
  @Post()
  create(@Body() dto: CreatePlatformAdminDto) {
    return this.managementService.create(dto);
  }

  @RequiresPlatformPermission(PlatformAdminPermission.PLATFORM_ADMINS_WRITE)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlatformAdminDto,
    @CurrentPlatformAdmin() admin: PlatformAdminAuth,
  ) {
    return this.managementService.update(id, dto, admin.id);
  }
}
