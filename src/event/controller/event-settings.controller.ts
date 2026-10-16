import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RequiresPermission } from '../../admin/decorator/requires-permission.decorator';
import { AdminPermission } from '../../admin/enum/admin-permission.enum';
import { CurrentAdmin } from '../../admin/decorator/current-admin.decorator';
import { Admin } from '../../admin/entity/admin.entity';
import { EventOverlapService } from '../service/event-overlap.service';
import { UpdateEventOverlapRuleDto } from '../dto/event-overlap-rule.dto';

// Registered before EventController so `events/settings` isn't taken as an event id.
@UseGuards(AdminGuard)
@Controller('events/settings')
export class EventSettingsController {
  constructor(private readonly overlapService: EventOverlapService) {}

  @RequiresPermission(AdminPermission.EVENTS_READ)
  @Get('overlap')
  getOverlap() {
    return this.overlapService.getConfig();
  }

  @RequiresPermission(AdminPermission.EVENTS_WRITE)
  @Patch('overlap')
  setOverlap(
    @Body() dto: UpdateEventOverlapRuleDto,
    @CurrentAdmin() admin: Admin,
  ) {
    return this.overlapService.setRule(dto.rule, admin.member.id);
  }
}
