// Mirrors src/admin/enum/admin-permission.enum.ts's shape and role
// (AdminPermission's control-plane counterpart) but is its own, disjoint
// enum — platform admins and tenant admins are separate identity/JWT
// systems (PlatformAdminGuard vs AdminGuard) that must never be able to
// satisfy each other's permission checks even where a string value happens
// to look similar.
export enum PlatformAdminPermission {
  TENANTS_READ = 'tenants:read',
  TENANTS_WRITE = 'tenants:write',
  // Separate from TENANTS_WRITE — issuing a live support-access token for a
  // tenant's admin is a materially bigger capability than renaming a tenant
  // or changing its plan, and should be grantable independently.
  TENANTS_IMPERSONATE = 'tenants:impersonate',
  PLANS_READ = 'plans:read',
  PLANS_WRITE = 'plans:write',
  COMMUNICATION_PROVIDERS_READ = 'communication_providers:read',
  COMMUNICATION_PROVIDERS_WRITE = 'communication_providers:write',
  BILLING_READ = 'billing:read',
  BILLING_WRITE = 'billing:write',
  ANALYTICS_READ = 'analytics:read',
  // Governs both platform admin *users* and the roles assigned to them —
  // a deliberately small, separate blast radius from everything else here,
  // since granting this is effectively granting "can grant any other
  // permission to anyone".
  PLATFORM_ADMINS_READ = 'platform_admins:read',
  PLATFORM_ADMINS_WRITE = 'platform_admins:write',
  // Sends one email to every active tenant's admin — deliberately its own
  // permission, not folded into an existing one, since misuse here reaches
  // every church on the platform at once (same "independently grantable,
  // bigger blast radius than it looks" reasoning as TENANTS_IMPERSONATE).
  BROADCAST_WRITE = 'broadcast:write',
}

export const PLATFORM_ADMIN_PERMISSION_LABELS: Record<
  PlatformAdminPermission,
  string
> = {
  [PlatformAdminPermission.TENANTS_READ]: 'View Tenants',
  [PlatformAdminPermission.TENANTS_WRITE]: 'Manage Tenants',
  [PlatformAdminPermission.TENANTS_IMPERSONATE]: 'Impersonate Tenant Admins',
  [PlatformAdminPermission.PLANS_READ]: 'View Plans',
  [PlatformAdminPermission.PLANS_WRITE]: 'Manage Plans',
  [PlatformAdminPermission.COMMUNICATION_PROVIDERS_READ]:
    'View Communication Providers',
  [PlatformAdminPermission.COMMUNICATION_PROVIDERS_WRITE]:
    'Manage Communication Providers',
  [PlatformAdminPermission.BILLING_READ]: 'View Billing & Refunds',
  [PlatformAdminPermission.BILLING_WRITE]: 'Issue Refunds',
  [PlatformAdminPermission.ANALYTICS_READ]: 'View Platform Analytics',
  [PlatformAdminPermission.PLATFORM_ADMINS_READ]: 'View Platform Admins',
  [PlatformAdminPermission.PLATFORM_ADMINS_WRITE]: 'Manage Platform Admins',
  [PlatformAdminPermission.BROADCAST_WRITE]: 'Send Tenant Broadcasts',
};

export interface PlatformAdminPermissionGroup {
  group: string;
  permissions: { value: PlatformAdminPermission; label: string }[];
}

function buildGroup(
  group: string,
  keys: PlatformAdminPermission[],
): PlatformAdminPermissionGroup {
  return {
    group,
    permissions: keys.map((value) => ({
      value,
      label: PLATFORM_ADMIN_PERMISSION_LABELS[value],
    })),
  };
}

// For a frontend permission-picker to render grouped checkboxes rather than
// one flat list of 12 — same reason AdminPermissionGroups exists tenant-side.
export const PlatformAdminPermissionGroups: PlatformAdminPermissionGroup[] = [
  buildGroup('Tenants', [
    PlatformAdminPermission.TENANTS_READ,
    PlatformAdminPermission.TENANTS_WRITE,
    PlatformAdminPermission.TENANTS_IMPERSONATE,
  ]),
  buildGroup('Plans', [
    PlatformAdminPermission.PLANS_READ,
    PlatformAdminPermission.PLANS_WRITE,
  ]),
  buildGroup('Communication Providers', [
    PlatformAdminPermission.COMMUNICATION_PROVIDERS_READ,
    PlatformAdminPermission.COMMUNICATION_PROVIDERS_WRITE,
  ]),
  buildGroup('Billing', [
    PlatformAdminPermission.BILLING_READ,
    PlatformAdminPermission.BILLING_WRITE,
  ]),
  buildGroup('Analytics', [PlatformAdminPermission.ANALYTICS_READ]),
  buildGroup('Platform Admins', [
    PlatformAdminPermission.PLATFORM_ADMINS_READ,
    PlatformAdminPermission.PLATFORM_ADMINS_WRITE,
  ]),
  buildGroup('Broadcasts', [PlatformAdminPermission.BROADCAST_WRITE]),
];
