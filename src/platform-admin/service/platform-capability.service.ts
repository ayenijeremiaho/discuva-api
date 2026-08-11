import { Injectable } from '@nestjs/common';
import { KNOWN_MODULES } from '../../church-settings/constants/known-modules.constant';
import { PlanFeature } from '../../billing/enum/plan-feature.enum';

export interface PlatformCapability {
  key: string;
  label: string;
}

// The 4 PlanFeature values with no KNOWN_MODULES counterpart — hand-labeled
// since they have no moduleName to borrow.
const ORPHAN_PLAN_FEATURE_LABELS: Partial<Record<PlanFeature, string>> = {
  [PlanFeature.FINANCE]: 'Finance',
  [PlanFeature.SMS]: 'SMS',
  [PlanFeature.AUDIT]: 'Audit Log',
  [PlanFeature.BULK_EXPORT]: 'Bulk Export',
};

@Injectable()
export class PlatformCapabilityService {
  // Every capability key a Plan's features array can validly contain,
  // labeled for the plan-edit UI — see capability-keys.constant.ts, this is
  // the same key set with human-readable labels attached instead of a bare
  // string set.
  list(): PlatformCapability[] {
    const modules: PlatformCapability[] = KNOWN_MODULES.map((m) => ({
      key: m.key,
      label: m.moduleName,
    }));
    const orphans: PlatformCapability[] = Object.entries(
      ORPHAN_PLAN_FEATURE_LABELS,
    ).map(([key, label]) => ({ key, label: label as string }));
    return [...modules, ...orphans].sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }
}
