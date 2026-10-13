import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { Request } from 'express';

type ClientIpRequest = Pick<Request, 'headers' | 'ip' | 'ips'>;

const header = (req: ClientIpRequest, name: string) => {
  const value = req.headers[name];
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
};

const sameKey = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

// The visitor's own address for rate limits.
// 1. The member app's server calls the API on visitors' behalf (pages, forms, shared events, church details) and
//    forwards who it's serving as X-Visitor-IP; that's believed only with the shared INTERNAL_API_KEY.
// 2. On Fly, the edge sets Fly-Client-IP itself (a client can't supply it), so it's trusted only there.
// 3. Otherwise Express's req.ip, which follows X-Forwarded-For only as far as `trust proxy` allows.
export function clientIp(
  req: ClientIpRequest,
  onFly = !!process.env.FLY_APP_NAME,
  internalKey = process.env.INTERNAL_API_KEY,
): string {
  const forwarded = header(req, 'x-visitor-ip');
  const key = header(req, 'x-internal-key');
  if (
    internalKey &&
    forwarded &&
    key &&
    sameKey(key, internalKey) &&
    isIP(forwarded)
  )
    return forwarded;

  if (onFly) {
    const fly = header(req, 'fly-client-ip');
    if (fly) return fly;
  }
  return req.ips?.[0] ?? req.ip ?? 'unknown';
}

// Hops of reverse proxy in front of the API. On Fly a request passes the edge and then Fly's internal proxy
// (production logs: X-Forwarded-For "<visitor>, <edge>" over a 172.16.x.x socket), so 2; 0 elsewhere.
export function trustProxyHops(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number.parseInt(env.TRUST_PROXY_HOPS ?? '', 10);
  if (Number.isInteger(configured) && configured >= 0) return configured;
  return env.FLY_APP_NAME ? 2 : 0;
}
