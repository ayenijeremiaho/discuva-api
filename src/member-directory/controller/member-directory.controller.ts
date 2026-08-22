import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { PlanGuard } from '../../billing/guard/plan.guard';
import { RequiresPlan } from '../../billing/decorator/requires-plan.decorator';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';
import { MemberDirectoryService } from '../service/member-directory.service';
import { UpdateDirectoryProfileDto } from '../dto/update-directory-profile.dto';

@RequiresModule('member_directory')
@RequiresPlan(PlanFeature.MEMBER_DIRECTORY)
@UseGuards(JwtAuthGuard, ModuleEnabledGuard, PlanGuard)
@Controller('member-directory')
export class MemberDirectoryController {
  constructor(private readonly directoryService: MemberDirectoryService) {}

  @Get('me')
  getMyProfile(@CurrentUser() user: MemberAuth) {
    return this.directoryService.getMyProfile(user.id);
  }

  @Patch('me')
  updateMyProfile(
    @CurrentUser() user: MemberAuth,
    @Body() dto: UpdateDirectoryProfileDto,
  ) {
    return this.directoryService.upsertMyProfile(user.id, dto);
  }

  @Get('me/completion')
  getCompletionStatus(@CurrentUser() user: MemberAuth) {
    return this.directoryService.getCompletionStatus(user.id);
  }

  @Get('search')
  search(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.directoryService.search(
      q,
      page ? +page : 1,
      limit ? +limit : 20,
    );
  }
}
