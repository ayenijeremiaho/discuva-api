// `req.hostname` never includes the port (Express strips it), so this only
// ever needs to handle the bare host part — 'church-alpha.example.com',
// 'church-alpha.localhost', 'example.com', 'localhost'.
//
// baseDomain is APP_BASE_DOMAIN (e.g. 'example.com' in prod, 'localhost' in
// dev — *.localhost resolves to 127.0.0.1 in every modern browser and in
// Node with no /etc/hosts changes, so dev subdomain testing needs no extra
// setup). Reserved words are rejected here rather than left to the caller,
// so 'never a valid tenant subdomain' is enforced in exactly one place.
const RESERVED_SUBDOMAINS = new Set(['www', 'api', 'admin', 'platform', 'app']);

export function extractSubdomain(
  hostname: string,
  baseDomain: string,
): string | null {
  const host = hostname.toLowerCase().trim();
  const base = baseDomain.toLowerCase().trim();

  if (host === base) return null; // bare root domain, no subdomain

  const suffix = `.${base}`;
  if (!host.endsWith(suffix)) return null; // unrelated host entirely

  const subdomain = host.slice(0, -suffix.length);
  if (!subdomain || subdomain.includes('.')) return null; // empty or multi-level — not a tenant subdomain
  if (RESERVED_SUBDOMAINS.has(subdomain)) return null;

  return subdomain;
}

export { RESERVED_SUBDOMAINS };
