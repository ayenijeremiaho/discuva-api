// Wildcard-subdomain tenancy means valid origins are unbounded, so this
// checks the APP_BASE_DOMAIN suffix dynamically instead of a static list —
// see docs/TECH_DOC.md's "CORS origin validation" for the full rationale.
export type CorsOriginValidator = (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
) => void;

export function createCorsOriginValidator(): CorsOriginValidator {
  const base = (process.env.APP_BASE_DOMAIN ?? 'localhost').toLowerCase();
  const explicitOrigins = new Set(
    (process.env.CORS_ORIGINS ?? '').split(',').map((o) => o.trim()),
  );

  return (origin, callback) => {
    if (!origin) return callback(null, true); // non-browser callers (curl, server-to-server) send no Origin
    if (explicitOrigins.has(origin)) return callback(null, true);

    let hostname: string;
    try {
      hostname = new URL(origin).hostname.toLowerCase();
    } catch {
      return callback(null, false);
    }

    callback(null, hostname === base || hostname.endsWith(`.${base}`));
  };
}
