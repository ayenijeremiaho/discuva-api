// Mirrors discuva-admin/utils/tenant/api-base-url.ts's getTenantApiBaseUrl
// exactly, server-side: LOGIN_URL/ADMIN_LOGIN_URL are configured as bare,
// tenant-less base URLs (one build/config serves every tenant via wildcard
// subdomain), so the tenant subdomain has to be inserted at send time
// instead — from tenant.subdomain here, from window.location there.
export function buildTenantUrl(baseUrl: string, subdomain: string): string {
  try {
    const url = new URL(baseUrl);
    url.hostname = `${subdomain}.${url.hostname}`;
    return url.toString().replace(/\/$/, '');
  } catch {
    return baseUrl;
  }
}
