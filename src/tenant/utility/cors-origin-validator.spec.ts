import { createCorsOriginValidator } from './cors-origin-validator';

describe('createCorsOriginValidator', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  const check = (
    validator: ReturnType<typeof createCorsOriginValidator>,
    origin: string | undefined,
  ): Promise<boolean | undefined> =>
    new Promise((resolve, reject) => {
      validator(origin, (err, allow) => (err ? reject(err) : resolve(allow)));
    });

  it('allows requests with no Origin header (non-browser callers)', async () => {
    process.env = {
      ...originalEnv,
      APP_BASE_DOMAIN: 'localhost',
      CORS_ORIGINS: '',
    };
    const validator = createCorsOriginValidator();
    await expect(check(validator, undefined)).resolves.toBe(true);
  });

  it('allows the bare base domain with no subdomain', async () => {
    process.env = {
      ...originalEnv,
      APP_BASE_DOMAIN: 'localhost',
      CORS_ORIGINS: '',
    };
    const validator = createCorsOriginValidator();
    await expect(check(validator, 'http://localhost:3003')).resolves.toBe(true);
  });

  it('allows any subdomain of the base domain, regardless of port', async () => {
    process.env = {
      ...originalEnv,
      APP_BASE_DOMAIN: 'localhost',
      CORS_ORIGINS: '',
    };
    const validator = createCorsOriginValidator();
    await expect(
      check(validator, 'http://frontend-test.localhost:3003'),
    ).resolves.toBe(true);
    await expect(
      check(validator, 'http://another-church.localhost:9999'),
    ).resolves.toBe(true);
  });

  it('rejects an unrelated domain not covered by the base domain or explicit allowlist', async () => {
    process.env = {
      ...originalEnv,
      APP_BASE_DOMAIN: 'localhost',
      CORS_ORIGINS: '',
    };
    const validator = createCorsOriginValidator();
    await expect(check(validator, 'http://evil.example.com')).resolves.toBe(
      false,
    );
  });

  it('rejects a domain that merely contains the base domain as a substring, not a suffix', async () => {
    process.env = {
      ...originalEnv,
      APP_BASE_DOMAIN: 'localhost',
      CORS_ORIGINS: '',
    };
    const validator = createCorsOriginValidator();
    await expect(
      check(validator, 'http://notlocalhost.evil.com'),
    ).resolves.toBe(false);
  });

  it('allows an explicitly listed origin even when it does not match the base domain', async () => {
    process.env = {
      ...originalEnv,
      APP_BASE_DOMAIN: 'localhost',
      CORS_ORIGINS: 'https://marketing.example.com, https://docs.example.com',
    };
    const validator = createCorsOriginValidator();
    await expect(
      check(validator, 'https://marketing.example.com'),
    ).resolves.toBe(true);
    await expect(check(validator, 'https://docs.example.com')).resolves.toBe(
      true,
    );
  });

  it('rejects a malformed origin', async () => {
    process.env = {
      ...originalEnv,
      APP_BASE_DOMAIN: 'localhost',
      CORS_ORIGINS: '',
    };
    const validator = createCorsOriginValidator();
    await expect(check(validator, 'not-a-valid-url')).resolves.toBe(false);
  });

  it('defaults APP_BASE_DOMAIN to localhost when unset', async () => {
    process.env = { ...originalEnv, CORS_ORIGINS: '' };
    delete process.env.APP_BASE_DOMAIN;
    const validator = createCorsOriginValidator();
    await expect(
      check(validator, 'http://frontend-test.localhost:3003'),
    ).resolves.toBe(true);
  });
});
