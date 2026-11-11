import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { NetworkClosureService } from '../service/network-closure.service';
import { ScheduleClosureDto } from '../dto/network.dto';

// Closing a branch: owners of a church above it set the date and where its members go.
@UseGuards(AdminGuard)
@Controller('network/closures')
export class NetworkClosureController {
  constructor(private readonly closures: NetworkClosureService) {}

  @RequiresPermission(AdminPermission.BRANCH_READ)
  @Get()
  list() {
    return this.closures.listHere();
  }

  @RequiresPermission(AdminPermission.BRANCH_WRITE)
  @Post()
  schedule(
    @CurrentAdmin() admin: Admin,
    @CurrentUser() user: MemberAuth,
    @Body() dto: ScheduleClosureDto,
  ) {
    return this.closures.schedule(admin, user.id, dto);
  }

  @RequiresPermission(AdminPermission.BRANCH_WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  cancel(
    @CurrentAdmin() admin: Admin,
    @CurrentUser() user: MemberAuth,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.closures.cancel(admin, user.id, id);
  }
}
