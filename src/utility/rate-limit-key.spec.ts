import { JwtService } from '@nestjs/jwt';
import { rateLimitKey, resetRateLimitKeyVerifiers } from './rate-limit-key';
import { hashId } from './log-safety';

const ACCESS = 'a'.repeat(40);
const REFRESH = 'r'.repeat(40);
const req = (over: Record<string, unknown> = {}) =>
  ({
    headers: { 'fly-client-ip': '102.212.253.9' },
    ip: '10.0.0.5',
    ips: [],
    ...over,
  }) as any;

describe('rateLimitKey', () => {
  const ENV = { ...process.env };
  beforeEach(() => {
    process.env = {
      ...ENV,
      JWT_SECRET: ACCESS,
      REFRESH_JWT_SECRET: REFRESH,
      FLY_APP_NAME: 'discuva-api',
    };
    delete process.env.INTERNAL_API_KEY;
    resetRateLimitKeyVerifiers();
  });
  afterAll(() => {
    process.env = ENV;
  });

  const bearer = (secret: string, payload: object) => ({
    authorization: `Bearer ${new JwtService({ secret }).sign(payload)}`,
    'fly-client-ip': '102.212.253.9',
  });

  it('counts a signed-in member as themselves, whatever network they are on, by a hash', () => {
    const { key, label } = rateLimitKey(
      req({ headers: bearer(ACCESS, { sub: 'm1', tenantId: 't1' }) }),
    );
    expect(key).toBe(`member:${hashId('t1:m1')}`);
    expect(label).toBe(key);
    expect(
      rateLimitKey(
        req({ headers: bearer(REFRESH, { sub: 'm1', tenantId: 't1' }) }),
      ).key,
    ).toBe(key);
    expect(key).not.toContain('m1');
  });

  it('treats a forged or expired token as anonymous', () => {
    expect(
      rateLimitKey(req({ headers: bearer('x'.repeat(40), { sub: 'm1' }) })).key,
    ).toBe('ip:102.212.253.9');
    const expired = bearer(ACCESS, {
      sub: 'm1',
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    expect(rateLimitKey(req({ headers: expired })).key).toBe(
      'ip:102.212.253.9',
    );
  });

  it('gives each person on a shared Wi-Fi their own sign-in tries, without holding their email', () => {
    const ada = rateLimitKey(
      req({ body: { email: ' Ada@Church.org ', password: 'x' } }),
    );
    const ben = rateLimitKey(req({ body: { email: 'ben@church.org' } }));
    expect(ada.key).toBe(`ip:102.212.253.9:email:${hashId('ada@church.org')}`);
    expect(ben.key).not.toBe(ada.key);
    expect(JSON.stringify([ada, ben])).not.toMatch(/church\.org|ada|ben/i);
    expect(ada.label).toBe(
      `ip:102.212.253.x:email:${hashId('ada@church.org')}`,
    );
  });

  it('keys biometric sign-in by the credential, and other anonymous calls by address', () => {
    expect(
      rateLimitKey(req({ body: { response: { id: 'cred-1' } } })).key,
    ).toBe(`ip:102.212.253.9:credential:${hashId('cred-1')}`);
    expect(rateLimitKey(req({ body: { email: 'not-an-email' } })).key).toBe(
      'ip:102.212.253.9',
    );
    expect(rateLimitKey(req()).label).toBe('ip:102.212.253.x');
  });
});
