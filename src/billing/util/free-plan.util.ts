import { Repository } from 'typeorm';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { OrganisationTypeEnum } from '../../tenant/enum/organisation-type.enum';

// Each account type starts on, and falls back to, its own free plan row.
const FREE_PLAN_ID: Record<OrganisationTypeEnum, string> = {
  [OrganisationTypeEnum.CHURCH]: 'free',
  [OrganisationTypeEnum.MINISTRY]: 'free',
  [OrganisationTypeEnum.GROUP]: 'group-free',
};

export const FREE_PLAN_IDS = [...new Set(Object.values(FREE_PLAN_ID))];

export function freePlanId(type?: OrganisationTypeEnum | null): string {
  return FREE_PLAN_ID[type ?? OrganisationTypeEnum.CHURCH] ?? 'free';
}

export function isFreePlan(planId?: string | null): boolean {
  return !planId || FREE_PLAN_IDS.includes(planId);
}

// A sponsored plan wins; asking for "free" means the account type's own free plan.
export function startingPlanId(
  type: OrganisationTypeEnum | null | undefined,
  planId?: string | null,
  sponsoredPlanId?: string | null,
): string {
  if (sponsoredPlanId) return sponsoredPlanId;
  return isFreePlan(planId) ? freePlanId(type) : planId!;
}

export async function tenantFreePlanId(
  tenantRepo: Repository<Tenant>,
  tenantId: string,
): Promise<string> {
  const tenant = await tenantRepo.findOne({
    where: { id: tenantId },
    select: { id: true, orgType: true },
  });
  return freePlanId(tenant?.orgType);
}
