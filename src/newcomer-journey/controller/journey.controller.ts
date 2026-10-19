import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorator/current-user.decorator';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { JourneyService } from '../service/journey.service';
import {
  JourneyRangeQueryDto,
  JourneyStuckQueryDto,
  SaveJourneySettingsDto,
} from '../dto/journey.dto';

@RequiresModule('newcomer_journey')
@UseGuards(JwtAuthGuard, ModuleEnabledGuard)
@Controller('journey')
export class JourneyController {
  constructor(private readonly journey: JourneyService) {}

  @Get('me')
  mine(@CurrentUser() user: MemberAuth) {
    return this.journey.mine(user.id);
  }
}

@RequiresModule('newcomer_journey')
@UseGuards(AdminGuard, ModuleEnabledGuard)
@Controller('admin/journey')
export class JourneyAdminController {
  constructor(private readonly journey: JourneyService) {}

  @Get('settings')
  @RequiresPermission(AdminPermission.FOLLOW_UP_READ)
  settings() {
    return this.journey.adminSteps();
  }

  @Put('settings')
  @RequiresPermission(AdminPermission.FOLLOW_UP_WRITE)
  save(@Body() dto: SaveJourneySettingsDto) {
    return this.journey.saveSettings({
      classTypeIds: dto.classTypeIds?.length ? dto.classTypeIds : null,
      stuckAfterDays: dto.stuckAfterDays,
    });
  }

  @Get('funnel')
  @RequiresPermission(AdminPermission.FOLLOW_UP_READ)
  funnel(@Query() q: JourneyRangeQueryDto) {
    return this.journey.funnel(new Date(q.from), new Date(q.to));
  }

  @Get('stuck')
  @RequiresPermission(AdminPermission.FOLLOW_UP_READ)
  stuck(@Query() q: JourneyStuckQueryDto) {
    return this.journey.stuck(
      q.step,
      new Date(q.from),
      new Date(q.to),
      q.page,
      q.limit,
    );
  }
}
