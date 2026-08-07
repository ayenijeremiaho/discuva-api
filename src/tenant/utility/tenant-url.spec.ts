import { buildTenantUrl } from './tenant-url';

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
