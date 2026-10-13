import { JwtService } from '@nestjs/jwt';
import { clientIp } from './client-ip';
import { hashId, maskIp } from './log-safety';

type KeyRequest = Parameters<typeof clientIp>[0] & { body?: unknown };

// Verifies only; no network, no database. Refresh tokens are signed with their own secret. Built on first use,
// after config has loaded .env (this module is imported before ConfigModule runs).
let verifiers: JwtService[] | null = null;
const getVerifiers = () =>
  (verifiers ??= [process.env.JWT_SECRET, process.env.REFRESH_JWT_SECRET]
    .filter((secret): secret is string => !!secret)
    .map((secret) => new JwtService({ secret })));

export function resetRateLimitKeyVerifiers() {
  verifiers = null;
}

function signedInMember(req: KeyRequest): string | null {
  const auth = req.headers.authorization;
  const value = Array.isArray(auth) ? auth[0] : auth;
  if (!value?.startsWith('Bearer ')) return null;
  const token = value.slice('Bearer '.length);
  for (const jwt of getVerifiers()) {
    try {
      const payload = jwt.verify<{ sub?: string; tenantId?: string }>(token);
      if (payload.sub)
        return `member:${hashId(`${payload.tenantId ?? '-'}:${payload.sub}`)}`;
    } catch {
      // not this kind of token
    }
  }
  return null;
}

const bodyField = (body: unknown, path: string[]): string | null => {
  let value: unknown = body;
  for (const key of path) {
    if (!value || typeof value !== 'object') return null;
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 254)
    : null;
};

// Who a rate limit counts against, as { key, label }: `key` is what the limiter counts by; `label` is the same with the
// address masked, for logs. Emails, credentials and members are only ever held as hashes. A congregation on one
// church Wi-Fi shares an address, so:
// - signed in: the member, whatever network they're on;
// - signing in, signing up or resetting (an email in the body): that email at that address, so each person
//   gets their own tries while one account can't be hammered from one place;
// - biometric sign-in: the credential at that address, for the same reason;
// - anything else anonymous: the address.
export function rateLimitKey(req: KeyRequest): { key: string; label: string } {
  const member = signedInMember(req);
  if (member) return { key: member, label: member };

  const ip = clientIp(req);
  const email = bodyField(req.body, ['email']);
  const credential = bodyField(req.body, ['response', 'id']);
  let suffix = '';
  if (email?.includes('@')) suffix = `:email:${hashId(email.toLowerCase())}`;
  else if (credential) suffix = `:credential:${hashId(credential)}`;
  return { key: `ip:${ip}${suffix}`, label: `ip:${maskIp(ip)}${suffix}` };
}
