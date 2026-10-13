import { createHmac } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';

// Keeps addresses useful in logs (Fly-internal vs a real visitor, which network) without identifying a person.
export function maskIp(ip: string | undefined | null): string | undefined {
  if (!ip) return undefined;
  const value = ip.trim();
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return `::ffff:${maskIp(mapped[1])}`;
  if (isIPv4(value)) return value.replace(/\.\d+$/, '.x');
  if (isIPv6(value)) return `${value.split(':').slice(0, 3).join(':')}::x`;
  return '[unparsed]';
}

// "102.212.253.9, 66.241.124.132" with each address masked.
export function maskIpList(list: string | undefined): string | undefined {
  return list
    ?.split(',')
    .map((part) => maskIp(part.trim()))
    .join(', ');
}

// A short, stable stand-in for an email, member or credential id: the same person always maps to the same value,
// but without the server's secret it can't be reversed or checked against a list of emails.
export function hashId(value: string): string {
  const key = process.env.JWT_SECRET || 'discuva-log-hash';
  return createHmac('sha256', key).update(value).digest('hex').slice(0, 12);
}
