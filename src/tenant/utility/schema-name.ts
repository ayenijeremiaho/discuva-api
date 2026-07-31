// Postgres schema names can't contain hyphens (subdomains can), so the
// mapping is deliberately not the identity function — `church-beta`
// becomes `church_beta`, prefixed so a schema never collides with a
// reserved word or the `public` schema itself.
export function subdomainToSchemaName(subdomain: string): string {
  return `church_${subdomain.toLowerCase().replace(/-/g, '_')}`;
}
