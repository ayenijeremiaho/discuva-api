import { Repository } from 'typeorm';
import { Tenant } from '../entity/tenant.entity';

export function isBranch(
  tenant: Pick<Tenant, 'id' | 'networkRootId'>,
): boolean {
  return !!tenant.networkRootId && tenant.networkRootId !== tenant.id;
}

// A branch without its own logo shows its network's, and follows the network's theme until it picks one.
export async function withNetworkBranding(
  repo: Repository<Tenant>,
  tenant: Tenant | null,
): Promise<Tenant | null> {
  if (!tenant || !isBranch(tenant)) return tenant;
  if (tenant.logoUrl && !tenant.themeFromNetwork) return tenant;
  const root = await repo.findOne({
    where: { id: tenant.networkRootId! },
    select: { id: true, logoUrl: true, themePreset: true },
  });
  if (!root) return tenant;
  return {
    ...tenant,
    logoUrl: tenant.logoUrl ?? root.logoUrl,
    themePreset: tenant.themeFromNetwork
      ? root.themePreset
      : tenant.themePreset,
  } as Tenant;
}
