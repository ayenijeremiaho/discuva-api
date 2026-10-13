// What each request log line records about the request. Logging only: nothing here changes rate limits.
// The three address fields show what the rate limiter keys on today (`rate-limit-key`, which is Express's req.ip)
// next to what Fly says the visitor was, so production logs can show whether limits are shared between visitors.
export function serializeRequest(req: {
  id?: unknown;
  method?: string;
  url?: string;
  query?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  remoteAddress?: string;
  raw?: { ip?: string };
}) {
  const headers = req.headers ?? {};
  const first = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;
  return {
    id: req.id,
    method: req.method,
    url: req.url,
    query: req.query,
    'content-type': first(headers['content-type']),
    'user-agent': first(headers['user-agent']),
    'x-real-ip': first(headers['x-real-ip']),
    'rate-limit-key': req.raw?.ip ?? req.remoteAddress,
    'fly-client-ip': first(headers['fly-client-ip']),
    'x-forwarded-for': first(headers['x-forwarded-for']),
  };
}
