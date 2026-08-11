// Single source of truth for the resolved-credential cache key shared by
// SmsCredentialResolverService, EmailCredentialResolverService,
// TenantCommunicationProviderService (invalidates on a tenant's own write),
// and PlatformCommunicationProviderService (invalidates on a platform-wide
// deactivate, across every affected tenant). Previously each of the first
// three computed this same string independently — extracted here once a
// 4th call site needed it too, so the format can't silently drift between
// them.
export function communicationProviderCacheKey(
  tenantId: string,
  channel: string,
): string {
  return `communication-provider-config:${tenantId}:${channel}`;
}
