import { SetMetadata } from '@nestjs/common';
import { PlanFeature } from '../enum/plan-feature.enum';

export const REQUIRES_PLAN_KEY = 'requires_plan';

export const RequiresPlan = (feature: PlanFeature) =>
  SetMetadata(REQUIRES_PLAN_KEY, feature);
