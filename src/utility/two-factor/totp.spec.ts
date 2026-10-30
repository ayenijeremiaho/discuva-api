import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  matchTotpStep,
  totpAt,
  totpUri,
} from './totp';

// RFC 6238 appendix B, SHA-1, cut to 6 digits.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));
const RFC_VECTORS: [number, string][] = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
];

describe('totp', () => {
  it.each(RFC_VECTORS)('matches the RFC vector at %i', (seconds, code) => {
    expect(totpAt(RFC_SECRET, Math.floor(seconds / 30))).toBe(code);
  });

  it('round-trips base32', () => {
    const bytes = Buffer.from('any bytes at all!');
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });

  it('accepts one step of clock drift and no more', () => {
    const now = 1234567890_000;
    const step = Math.floor(now / 30_000);
    expect(matchTotpStep(RFC_SECRET, totpAt(RFC_SECRET, step), now)).toBe(step);
    expect(matchTotpStep(RFC_SECRET, totpAt(RFC_SECRET, step - 1), now)).toBe(
      step - 1,
    );
    expect(matchTotpStep(RFC_SECRET, totpAt(RFC_SECRET, step + 1), now)).toBe(
      step + 1,
    );
    expect(
      matchTotpStep(RFC_SECRET, totpAt(RFC_SECRET, step + 2), now),
    ).toBeNull();
  });

  it('rejects a code of the wrong length without throwing', () => {
    expect(matchTotpStep(RFC_SECRET, '12345', 1234567890_000)).toBeNull();
  });

  it('generates a 160-bit secret', () => {
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('builds an authenticator link', () => {
    expect(totpUri('Discuva Platform', 'a@example.com', 'ABC')).toBe(
      'otpauth://totp/Discuva%20Platform:a%40example.com?secret=ABC&issuer=Discuva+Platform&algorithm=SHA1&digits=6&period=30',
    );
  });
});
