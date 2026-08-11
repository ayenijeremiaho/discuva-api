import { PlanFeature } from '../enum/plan-feature.enum';
import { KNOWN_MODULES } from '../../church-settings/constants/known-modules.constant';

// Every string a Plan.features entry (or a featureLimits key) is allowed to
// be: the legacy PlanFeature values (finance/sms/audit/bulk_export have no
// KNOWN_MODULES counterpart and stay purely plan-gated) unioned with every
// toggleable module's own key — ModuleEnabledGuard checks a module's plan
// membership using that same key (see module-enabled.guard.ts), so any
// module is plan-assignable without a code change.
export const ALL_CAPABILITY_KEYS: string[] = Array.from(
  new Set<string>([
    ...Object.values(PlanFeature),
    ...KNOWN_MODULES.map((m) => m.key),
  ]),
);
