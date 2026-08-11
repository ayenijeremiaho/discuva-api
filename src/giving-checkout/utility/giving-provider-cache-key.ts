// Single source of truth for the resolved-credential cache key shared by
// GivingCheckoutService, TenantGivingProviderService (invalidates on a
// tenant's own write), and PlatformGivingProviderService (invalidates on a
// platform-wide deactivate, across every affected tenant). Same reasoning
// as communication-provider-cache-key.ts — extracted once a 3rd/4th call
// site needed the identical string, rather than each computing it
// independently. No channel dimension here (unlike communication
// providers) — giving has exactly one "channel".
export function givingProviderCacheKey(tenantId: string): string {
  return `giving-provider-config:${tenantId}`;
}
