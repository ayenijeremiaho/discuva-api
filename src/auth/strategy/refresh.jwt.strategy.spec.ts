import { refreshTokenFrom } from './refresh.jwt.strategy';

const req = (
  headers: Record<string, string> = {},
  cookies: Record<string, string> = {},
) =>
  ({ headers, cookies, get: (n: string) => headers[n.toLowerCase()] }) as any;

describe('refreshTokenFrom', () => {
  it("uses the member app's own token even when an admin's cookie rides along from the same browser", () => {
    expect(
      refreshTokenFrom(
        req(
          { authorization: 'Bearer member-refresh' },
          { refresh_token: 'admin-refresh' },
        ),
      ),
    ).toBe('member-refresh');
  });

  it('falls back to the cookie for the admin web app, which sends no token of its own', () => {
    expect(refreshTokenFrom(req({}, { refresh_token: 'admin-refresh' }))).toBe(
      'admin-refresh',
    );
    expect(refreshTokenFrom(req())).toBeNull();
  });
});
