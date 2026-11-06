import { Injectable } from '@nestjs/common';
import { KNOWN_MODULES } from '../../church-settings/constants/known-modules.constant';
import { ORPHAN_PLAN_FEATURE_LABELS } from '../../billing/constant/plan-feature-labels.constant';

export interface PlatformCapability {
  key: string;
  label: string;
}

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
