import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { PlanGuard } from '../../billing/guard/plan.guard';
import { RequiresPlan } from '../../billing/decorator/requires-plan.decorator';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';
import { MemberDirectoryService } from '../service/member-directory.service';
import { MemberService } from '../../member/service/member.service';
import { MemberStatusEnum } from '../../member/enums/member-status.enum';

@RequiresModule('member_directory')
@RequiresPlan(PlanFeature.MEMBER_DIRECTORY)
@UseGuards(AdminGuard, ModuleEnabledGuard, PlanGuard)
@Controller('admin/member-directory')
export class MemberDirectoryAdminController {
  constructor(
    private readonly directoryService: MemberDirectoryService,
    private readonly memberService: MemberService,
  ) {}

  // Read-only, aggregate only — see MemberDirectoryService.getAnalytics for
  // why phone/email never appear here regardless of a member's own
  // showPhone/showEmail choice.
  @Get('analytics')
  @RequiresPermission(AdminPermission.MEMBER_DIRECTORY_READ)
  async getAnalytics() {
    const totalMembers = await this.memberService.count({
      where: { status: MemberStatusEnum.ACTIVE },
    });
    return this.directoryService.getAnalytics(totalMembers);
  }
}
