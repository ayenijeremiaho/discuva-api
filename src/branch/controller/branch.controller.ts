import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { BranchRollupService } from '../service/branch-rollup.service';
import { GivingSharingDto } from '../dto/network.dto';

// A branch's own choice on sharing giving with the churches above it (the figures themselves are GET /network/report).
@UseGuards(AdminGuard)
@Controller('branch')
export class BranchController {
  constructor(private readonly branchRollupService: BranchRollupService) {}

  @RequiresPermission(AdminPermission.BRANCH_READ)
  @Get('giving-sharing')
  getGivingSharing() {
    return this.branchRollupService.getGivingSharing();
  }

  @RequiresPermission(AdminPermission.BRANCH_WRITE)
  @Patch('giving-sharing')
  setGivingSharing(@Body() dto: GivingSharingDto) {
    return this.branchRollupService.setGivingSharing(dto.shareGivingWithParent);
  }
}
