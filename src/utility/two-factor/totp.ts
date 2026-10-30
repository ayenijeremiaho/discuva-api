import { createHmac, randomBytes } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return bits > 0 ? out + BASE32[(value << (5 - bits)) & 31] : out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Invalid base32 value');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

// RFC 6238 over RFC 4226, SHA-1: the only variant every authenticator app supports.
export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secret))
    .update(counter)
    .digest();
  const offset = hmac[hmac.length - 1] & 15;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return code.toString().padStart(DIGITS, '0');
}

// The matching time step, one step either side for clock drift; null when the code is wrong.
export function matchTotpStep(
  secret: string,
  code: string,
  now = Date.now(),
): number | null {
  const current = Math.floor(now / 1000 / PERIOD_SECONDS);
  for (const step of [current, current - 1, current + 1]) {
    if (step >= 0 && totpAt(secret, step) === code) return step;
  }
  return null;
}

export function totpUri(issuer: string, account: string, secret: string) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
