import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PlatformAdminGuard } from '../guard/platform-admin.guard';
import { Public } from '../../auth/decorator/public.decorator';
import { PlatformAnalyticsService } from '../service/platform-analytics.service';
import { RequiresPlatformPermission } from '../decorator/requires-platform-permission.decorator';
import { PlatformAdminPermission } from '../enum/platform-admin-permission.enum';
import { AnalyticsTrendQueryDto } from '../dto/analytics-trend-query.dto';

// @Public() at class level for the same reason as PlatformAdminController —
// the global JwtAuthGuard runs on every route regardless of @UseGuards()
// also being applied per-handler, and a platform admin never has a tenant
// JWT, so it would 401 before PlatformAdminGuard (below) got a chance to.
@Public()
@UseGuards(PlatformAdminGuard)
@RequiresPlatformPermission(PlatformAdminPermission.ANALYTICS_READ)
@Controller('platform/analytics')
export class PlatformAnalyticsController {
  constructor(private readonly analyticsService: PlatformAnalyticsService) {}

  @Get('overview')
  getOverview() {
    return this.analyticsService.getOverview();
  }

  @Get('growth')
  getGrowth(@Query() query: AnalyticsTrendQueryDto) {
    return this.analyticsService.getGrowth(query.period, query.months);
  }

  @Get('revenue')
  getRevenue(@Query() query: AnalyticsTrendQueryDto) {
    return this.analyticsService.getRevenue(query.period, query.months);
  }

  @Get('engagement')
  getEngagement() {
    return this.analyticsService.getEngagement();
  }

  @Get('churn')
  getChurn(@Query() query: AnalyticsTrendQueryDto) {
    return this.analyticsService.getChurn(query.period, query.months);
  }

  @Get('adoption')
  getAdoption() {
    return this.analyticsService.getAdoption();
  }

  @Get('giving')
  getGiving(@Query() query: AnalyticsTrendQueryDto) {
    return this.analyticsService.getGiving(query.period, query.months);
  }
}
