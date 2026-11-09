import { LocalStrategy } from './local.strategy';

describe('LocalStrategy', () => {
  const authService = {
    validateMember: jest.fn().mockResolvedValue({ id: 'm1' }),
  };
  const strategy = new LocalStrategy(authService as never);
  const req = (path: string, body: object = {}) =>
    ({ path, body, headers: {}, ip: '203.0.113.7', ips: [] }) as never;

  beforeEach(() => jest.clearAllMocks());

  it('counts portal sign-ins by network address', async () => {
    await strategy.validate(req('/v1/auth/admin-login'), 'a@b.co', 'pw');
    expect(authService.validateMember).toHaveBeenCalledWith(
      'a@b.co',
      'pw',
      undefined,
      {
        ip: '203.0.113.7',
      },
    );
  });

  it('counts member app sign-ins by phone', async () => {
    await strategy.validate(
      req('/v1/auth/login', { deviceId: 'phone-123' }),
      'a@b.co',
      'pw',
    );
    expect(authService.validateMember).toHaveBeenCalledWith(
      'a@b.co',
      'pw',
      'phone-123',
      undefined,
    );
  });
});
