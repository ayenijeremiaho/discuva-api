import { buildAdminUrl, buildTenantUrl } from './tenant-url';

describe('buildTenantUrl', () => {
  it('inserts the subdomain as the leftmost host label, keeping the rest of the URL intact', () => {
    expect(
      buildTenantUrl('https://discuva.org/admin/login', 'church-alpha'),
    ).toBe('https://church-alpha.discuva.org/admin/login');
  });

  it('does not leave a trailing slash when the base URL has no path', () => {
    expect(buildTenantUrl('https://discuva.org', 'church-alpha')).toBe(
      'https://church-alpha.discuva.org',
    );
  });

  it('preserves query strings and other URL parts', () => {
    expect(
      buildTenantUrl('https://discuva.org/login?ref=email', 'church-alpha'),
    ).toBe('https://church-alpha.discuva.org/login?ref=email');
  });

  it('returns the original value unchanged when it is not a valid absolute URL', () => {
    expect(buildTenantUrl('not-a-url', 'church-alpha')).toBe('not-a-url');
    expect(buildTenantUrl(undefined as unknown as string, 'church-alpha')).toBe(
      undefined,
    );
  });
});

describe('buildAdminUrl', () => {
  it('adds the subdomain as a query param, leaving the host and existing path untouched when no path override is given', () => {
    expect(
      buildAdminUrl('https://admin.discuva.org/login', '', {
        subdomain: 'church-alpha',
      }),
    ).toBe('https://admin.discuva.org/login?subdomain=church-alpha');
  });

  it('replaces the base path when one is given, rather than appending onto it', () => {
    expect(
      buildAdminUrl('https://admin.discuva.org/login', '/set-password', {
        subdomain: 'church-alpha',
      }),
    ).toBe('https://admin.discuva.org/set-password?subdomain=church-alpha');
  });

  it('adds every param supplied, in insertion order', () => {
    expect(
      buildAdminUrl('https://admin.discuva.org', '/set-password', {
        email: 'admin@church.org',
        otp: '123456',
        subdomain: 'church-alpha',
      }),
    ).toBe(
      'https://admin.discuva.org/set-password?email=admin%40church.org&otp=123456&subdomain=church-alpha',
    );
  });

  it('returns the original value unchanged when it is not a valid absolute URL', () => {
    expect(buildAdminUrl('not-a-url', '', { subdomain: 'church-alpha' })).toBe(
      'not-a-url',
    );
  });
});
