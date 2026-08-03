import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export type AnalyticsPeriod = 'daily' | 'weekly' | 'monthly';

// Query params shared by every trend-shaped analytics endpoint (growth,
// revenue, churn) — how to bucket the trend, and how far back to look.
// `months` bounds the raw-row fetch (all of it pulled into memory and
// bucketed in JS, same convention as ServiceHeadcountService's own trend
// endpoint) — unbounded would eventually mean scanning every tenant/
// checkout-session/cancellation ever, for a chart nobody would want that
// granular anyway.
export class AnalyticsTrendQueryDto {
  @IsOptional()
  @IsIn(['daily', 'weekly', 'monthly'])
  period?: AnalyticsPeriod = 'monthly';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(36)
  months?: number = 12;
}
