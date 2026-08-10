// Mirrors discuva-admin/utils/tenant/api-base-url.ts's getTenantApiBaseUrl
// exactly, server-side: LOGIN_URL is configured as a bare, tenant-less base
// URL (one build serves every tenant via wildcard subdomain), so the tenant
// subdomain has to be inserted at send time instead — from tenant.subdomain
// here, from window.location there. Only for LOGIN_URL (discuva-member) —
// see buildAdminUrl below for ADMIN_LOGIN_URL, which this does NOT apply to.
export function buildTenantUrl(baseUrl: string, subdomain: string): string {
  try {
    const url = new URL(baseUrl);
    url.hostname = `${subdomain}.${url.hostname}`;
    return url.toString().replace(/\/$/, '');
  } catch {
    return baseUrl;
  }
}

// discuva-admin lives at a single fixed host shared by every tenant, not a
// wildcard (docs/MULTI_TENANT_MIGRATION.md Phase 9l) — subdomain-prepending
// the way buildTenantUrl does would produce a hostname that doesn't
// resolve. The tenant identifier instead travels as a `subdomain` query
// param, which discuva-admin's login/set-password forms read and pre-fill
// their "Church Subdomain" field from (the same field/header
// TenantMiddleware's fallback resolution already expects — see
// TenantMiddleware's own doc comment). `path`, if given, REPLACES
// baseUrl's own path (e.g. '/set-password' rather than appending onto
// ADMIN_LOGIN_URL's own '/login') — matches how an absolute path behaves
// as the WHATWG URL constructor's first argument against a base.
export function buildAdminUrl(
  baseUrl: string,
  path: string,
  params: Record<string, string>,
): string {
  try {
    const url = new URL(path || '', baseUrl);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  } catch {
    return baseUrl;
  }
}
