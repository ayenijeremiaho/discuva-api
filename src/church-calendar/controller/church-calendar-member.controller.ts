import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { PlanGuard } from '../../billing/guard/plan.guard';
import { RequiresPlan } from '../../billing/decorator/requires-plan.decorator';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';
import { ChurchCalendarService } from '../service/church-calendar.service';

// Mounted at a distinct `church-calendar/member` sub-path, not the same base
// as ChurchCalendarAdminController's `:id` wildcard — sidesteps the
// route-ordering fragility PagesModule's own comment documents (its public
// and admin controllers share one base path and depend on registration
// order in the module's `controllers` array).
@RequiresModule('church_calendar')
@RequiresPlan(PlanFeature.CHURCH_CALENDAR)
@UseGuards(JwtAuthGuard, ModuleEnabledGuard, PlanGuard)
@Controller('church-calendar/member')
export class ChurchCalendarMemberController {
  constructor(private readonly calendarService: ChurchCalendarService) {}

  @Get('current')
  getCurrent() {
    return this.calendarService.getCurrentForMember();
  }
}
