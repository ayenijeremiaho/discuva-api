import { KNOWN_MODULES } from '../../church-settings/constants/known-modules.constant';
import { PlanFeature } from '../enum/plan-feature.enum';

// PlanFeature values with no KNOWN_MODULES counterpart — hand-labeled since they have no moduleName to borrow.
export const ORPHAN_PLAN_FEATURE_LABELS: Partial<Record<PlanFeature, string>> =
  {
    [PlanFeature.FINANCE]: 'Finance',
    [PlanFeature.SMS]: 'SMS',
    [PlanFeature.AUDIT]: 'Audit Log',
    [PlanFeature.BULK_EXPORT]: 'Bulk Export',
    [PlanFeature.NOTIFICATION_CUSTOMIZATION]: 'Notification Customization',
  };

const LABELS = new Map<string, string>([
  ...KNOWN_MODULES.map((m) => [m.key, m.moduleName] as [string, string]),
  ...(Object.entries(ORPHAN_PLAN_FEATURE_LABELS) as [string, string][]),
]);

export const planFeatureLabel = (key: string): string | undefined =>
  LABELS.get(key);
