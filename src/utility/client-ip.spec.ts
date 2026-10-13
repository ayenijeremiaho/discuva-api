import { clientIp, trustProxyHops } from './client-ip';

const req = (
  headers: Record<string, string> = {},
  ip = '10.0.0.5',
  ips: string[] = [],
) => ({ headers, ip, ips }) as any;

describe('clientIp', () => {
  it("uses Fly's own client header on Fly", () => {
    expect(clientIp(req({ 'fly-client-ip': '203.0.113.7' }), true)).toBe(
      '203.0.113.7',
    );
  });

  it('ignores a Fly header sent from anywhere else, so it cannot be spoofed off Fly', () => {
    expect(clientIp(req({ 'fly-client-ip': '203.0.113.7' }), false)).toBe(
      '10.0.0.5',
    );
  });

  it('falls back to the first trusted forwarded address, then the socket address', () => {
    expect(clientIp(req({}, '10.0.0.5', ['198.51.100.2']), false)).toBe(
      '198.51.100.2',
    );
    expect(clientIp(req({}, '10.0.0.5'), true)).toBe('10.0.0.5');
  });
});

describe('clientIp from the member app server', () => {
  const KEY = 'k'.repeat(40);

  it('counts the forwarded visitor when the internal key matches', () => {
    const r = req({
      'x-visitor-ip': '198.51.100.20',
      'x-internal-key': KEY,
      'fly-client-ip': '203.0.113.1',
    });
    expect(clientIp(r, true, KEY)).toBe('198.51.100.20');
  });

  it('ignores a forwarded address without the right key, or when no key is configured', () => {
    const forged = req({
      'x-visitor-ip': '198.51.100.20',
      'x-internal-key': 'guess',
      'fly-client-ip': '203.0.113.1',
    });
    expect(clientIp(forged, true, KEY)).toBe('203.0.113.1');
    const unkeyed = req(
      { 'x-visitor-ip': '198.51.100.20', 'x-internal-key': KEY },
      '10.0.0.5',
    );
    expect(clientIp(unkeyed, false, undefined)).toBe('10.0.0.5');
  });

  it('ignores a forwarded value that is not an IP address', () => {
    const r = req(
      { 'x-visitor-ip': 'everyone', 'x-internal-key': KEY },
      '10.0.0.5',
    );
    expect(clientIp(r, false, KEY)).toBe('10.0.0.5');
  });
});

describe('trustProxyHops', () => {
  it('trusts two hops on Fly (edge + internal proxy) and none elsewhere, unless configured', () => {
    expect(trustProxyHops({ FLY_APP_NAME: 'discuva-api' })).toBe(2);
    expect(trustProxyHops({})).toBe(0);
    expect(trustProxyHops({ TRUST_PROXY_HOPS: '2' })).toBe(2);
    expect(
      trustProxyHops({ TRUST_PROXY_HOPS: 'nonsense', FLY_APP_NAME: 'x' }),
    ).toBe(2);
  });
});
