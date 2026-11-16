import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PlatformAdminGuard } from '../guard/platform-admin.guard';
import { Public } from '../../auth/decorator/public.decorator';
import { PlatformAnalyticsService } from '../service/platform-analytics.service';
import { RequiresPlatformPermission } from '../decorator/requires-platform-permission.decorator';
import { PlatformAdminPermission } from '../enum/platform-admin-permission.enum';
import {
  AnalyticsFreshQueryDto,
  AnalyticsTrendQueryDto,
} from '../dto/analytics-trend-query.dto';
import { CacheService } from '../../utility/service/cache.service';

const CACHE_SECONDS = 600;

// @Public() at class level for the same reason as PlatformAdminController —
// the global JwtAuthGuard runs on every route regardless of @UseGuards()
// also being applied per-handler, and a platform admin never has a tenant
// JWT, so it would 401 before PlatformAdminGuard (below) got a chance to.
@Public()
@UseGuards(PlatformAdminGuard)
@RequiresPlatformPermission(PlatformAdminPermission.ANALYTICS_READ)
@Controller('platform/analytics')
export class PlatformAnalyticsController {
  constructor(
    private readonly analyticsService: PlatformAnalyticsService,
    private readonly cache: CacheService,
  ) {}

  // The figures underneath change overnight, so a short shared cache spares the database on every visit.
  private async cached<T>(
    key: string,
    fresh: boolean | undefined,
    load: () => Promise<T>,
  ): Promise<T> {
    const cacheKey = `platform-analytics:${key}`;
    if (!fresh) {
      const hit = await this.cache.getGlobal<T>(cacheKey);
      if (hit !== undefined) return hit;
    }
    const value = await load();
    this.cache.setGlobal(cacheKey, value, CACHE_SECONDS);
    return value;
  }

  @Get('overview')
  getOverview(@Query() q: AnalyticsFreshQueryDto) {
    return this.cached('overview', q.fresh, () =>
      this.analyticsService.getOverview(),
    );
  }

  @Get('growth')
  getGrowth(@Query() query: AnalyticsTrendQueryDto) {
    return this.cached(
      `growth:${query.period}:${query.months}`,
      query.fresh,
      () => this.analyticsService.getGrowth(query.period, query.months),
    );
  }

  @Get('revenue')
  getRevenue(@Query() query: AnalyticsTrendQueryDto) {
    return this.cached(
      `revenue:${query.period}:${query.months}`,
      query.fresh,
      () => this.analyticsService.getRevenue(query.period, query.months),
    );
  }

  @Get('engagement')
  getEngagement(@Query() q: AnalyticsFreshQueryDto) {
    return this.cached('engagement', q.fresh, () =>
      this.analyticsService.getEngagement(),
    );
  }

  @Get('churn')
  getChurn(@Query() query: AnalyticsTrendQueryDto) {
    return this.cached(
      `churn:${query.period}:${query.months}`,
      query.fresh,
      () => this.analyticsService.getChurn(query.period, query.months),
    );
  }

  @Get('adoption')
  getAdoption(@Query() q: AnalyticsFreshQueryDto) {
    return this.cached('adoption', q.fresh, () =>
      this.analyticsService.getAdoption(),
    );
  }

  @Get('giving')
  getGiving(@Query() query: AnalyticsTrendQueryDto) {
    return this.cached(
      `giving:${query.period}:${query.months}`,
      query.fresh,
      () => this.analyticsService.getGiving(query.period, query.months),
    );
  }
}
