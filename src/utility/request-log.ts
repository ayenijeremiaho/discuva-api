// What request log lines record. Nothing that identifies a person or grants access: no query values (Programme
// Manager and preview links carry tokens there, searches carry names), no bodies, no auth or cookie headers, no
// Set-Cookie on the way out (refresh tokens), and addresses masked. `rate-limit-key` is who the rate limiter counted
// the request against (set by AppThrottlerGuard), beside what Fly says the visitor was.
import { clientIp } from './client-ip';
import { maskIp, maskIpList } from './log-safety';

type Headers = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | number | undefined) =>
  Array.isArray(v) ? v[0] : v;

export function serializeRequest(req: {
  id?: unknown;
  method?: string;
  url?: string;
  query?: unknown;
  headers?: Headers;
  remoteAddress?: string;
  raw?: {
    rateLimitLabel?: string;
    headers?: Headers;
    ip?: string;
    ips?: string[];
  };
}) {
  const headers = req.headers ?? {};
  const query =
    req.query && typeof req.query === 'object'
      ? Object.keys(req.query as object)
      : [];
  return {
    id: req.id,
    method: req.method,
    url: req.url?.split('?')[0],
    ...(query.length ? { 'query-keys': query } : {}),
    'content-type': first(headers['content-type']),
    'user-agent': first(headers['user-agent']),
    'rate-limit-key':
      req.raw?.rateLimitLabel ??
      `ip:${maskIp(req.raw?.headers ? clientIp(req.raw as any) : req.remoteAddress)}`,
    'fly-client-ip': maskIp(
      first(headers['fly-client-ip']) as string | undefined,
    ),
    'x-forwarded-for': maskIpList(
      first(headers['x-forwarded-for']) as string | undefined,
    ),
  };
}

const SAFE_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'retry-after',
];

export function serializeResponse(res: {
  statusCode?: number;
  headers?: Record<string, string | string[] | number | undefined>;
}) {
  const headers = res.headers ?? {};
  const safe: Record<string, unknown> = {};
  for (const name of SAFE_RESPONSE_HEADERS)
    if (headers[name] !== undefined) safe[name] = first(headers[name]);
  return { statusCode: res.statusCode, headers: safe };
}
