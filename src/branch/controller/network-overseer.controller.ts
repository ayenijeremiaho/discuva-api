import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { NetworkOverseerService } from '../service/network-overseer.service';
import { AddOverseerDto, OverseerPassDto } from '../dto/network.dto';

@UseGuards(AdminGuard)
@Controller('network/overseers')
export class NetworkOverseerController {
  constructor(private readonly overseers: NetworkOverseerService) {}

  @RequiresPermission(AdminPermission.BRANCH_READ)
  @Get()
  view(@CurrentAdmin() admin: Admin) {
    return this.overseers.view(admin);
  }

  @RequiresPermission(AdminPermission.BRANCH_WRITE)
  @Post()
  add(@CurrentAdmin() admin: Admin, @Body() dto: AddOverseerDto) {
    return this.overseers.add(admin, dto.adminId);
  }

  @RequiresPermission(AdminPermission.BRANCH_READ)
  @Delete(':id')
  remove(@CurrentAdmin() admin: Admin, @Param('id', ParseUUIDPipe) id: string) {
    return this.overseers.remove(admin, id);
  }

  @RequiresPermission(AdminPermission.BRANCH_READ)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('pass')
  pass(@CurrentAdmin() admin: Admin, @Body() dto: OverseerPassDto) {
    return this.overseers.pass(admin, dto.tenantId);
  }
}
