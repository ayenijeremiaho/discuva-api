import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { NetworkService } from '../service/network.service';
import {
  AddBranchDto,
  MoveChurchDto,
  NetworkLevelsDto,
} from '../dto/network.dto';

@UseGuards(AdminGuard)
@Controller('network')
export class NetworkController {
  constructor(private readonly network: NetworkService) {}

  @RequiresPermission(AdminPermission.BRANCH_READ)
  @Get()
  view(@CurrentAdmin() admin: Admin) {
    return this.network.view(admin);
  }

  @RequiresPermission(AdminPermission.BRANCH_WRITE)
  @Get('address')
  previewAddress(@Query('label') label = '') {
    return this.network.previewAddress(label);
  }

  @RequiresPermission(AdminPermission.BRANCH_WRITE)
  @Post('branches')
  addBranch(@CurrentAdmin() admin: Admin, @Body() dto: AddBranchDto) {
    return this.network.addBranch(admin, dto);
  }

  @RequiresPermission(AdminPermission.BRANCH_WRITE)
  @Patch('churches/:id/parent')
  move(
    @CurrentAdmin() admin: Admin,
    @CurrentUser() user: MemberAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveChurchDto,
  ) {
    return this.network.moveChurch(admin, id, dto.parentId, user.id);
  }

  @RequiresPermission(AdminPermission.BRANCH_WRITE)
  @Put('levels')
  setLevels(@CurrentAdmin() admin: Admin, @Body() dto: NetworkLevelsDto) {
    return this.network.setLevels(admin, dto.names);
  }
}
