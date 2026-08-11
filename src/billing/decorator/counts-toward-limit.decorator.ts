import { SetMetadata } from '@nestjs/common';
import { PlanFeature } from '../enum/plan-feature.enum';

export const COUNTS_TOWARD_LIMIT_KEY = 'counts_toward_limit';

// Method-level only — marks the single route within a @RequiresPlan
// controller that should consume a FeatureUsage unit on success (e.g. the
// "create" route, not every read/list/poll route sharing the same class-
// level plan gate). See PlanGuard's pre-check and PlanLimitInterceptor's
// post-success consumption.
export const CountsTowardLimit = (feature: PlanFeature) =>
  SetMetadata(COUNTS_TOWARD_LIMIT_KEY, feature);
