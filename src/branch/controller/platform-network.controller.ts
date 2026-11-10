import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { PlatformAdminGuard } from '../../platform-admin/guard/platform-admin.guard';
import { RequiresPlatformPermission } from '../../platform-admin/decorator/requires-platform-permission.decorator';
import { PlatformAdminPermission } from '../../platform-admin/enum/platform-admin-permission.enum';
import { Public } from '../../auth/decorator/public.decorator';
import { NetworkService } from '../service/network.service';

// Console view of church networks: structure and figures, never members' details.
@Public()
@UseGuards(PlatformAdminGuard)
@Controller('platform/networks')
export class PlatformNetworkController {
  constructor(private readonly network: NetworkService) {}

  @RequiresPlatformPermission(PlatformAdminPermission.TENANTS_READ)
  @Get()
  list() {
    return this.network.platformNetworks();
  }

  @RequiresPlatformPermission(PlatformAdminPermission.TENANTS_READ)
  @Get(':rootId')
  detail(@Param('rootId', ParseUUIDPipe) rootId: string) {
    return this.network.platformNetwork(rootId);
  }
}
