import { ForbiddenException } from '@nestjs/common';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformAdminAuth } from '../interface/platform-admin-auth.interface';

// Spying on the actual parent prototype PlatformAdminGuard extends (not a
// fresh AuthGuard('platform-admin-jwt') call, which would return a
// different mixin class instance than the one baked into the guard's real
// inheritance chain at module-load time) — this is what super.canActivate()
// actually resolves to at call time.
const parentProto = Object.getPrototypeOf(PlatformAdminGuard.prototype);

function buildContext(user: PlatformAdminAuth) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any;
}

const mockAdmin = (permissions: string[]): PlatformAdminAuth => ({
  id: 'admin-1',
  email: 'admin@example.com',
  role: 'platform_admin',
  permissions,
});

describe('PlatformAdminGuard', () => {
  const mockReflector = { getAllAndOverride: jest.fn() };
  let guard: PlatformAdminGuard;
  let superCanActivateSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new PlatformAdminGuard(mockReflector as any);
    superCanActivateSpy = jest
      .spyOn(parentProto, 'canActivate')
      .mockResolvedValue(true);
  });

  afterEach(() => {
    superCanActivateSpy.mockRestore();
  });

  it('rejects immediately when the underlying JWT strategy rejects, without checking permissions', async () => {
    superCanActivateSpy.mockResolvedValue(false);
    const result = await guard.canActivate(buildContext(mockAdmin([])));
    expect(result).toBe(false);
    expect(mockReflector.getAllAndOverride).not.toHaveBeenCalled();
  });

  it('allows access when the route requires no specific permission', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(undefined);
    const result = await guard.canActivate(buildContext(mockAdmin([])));
    expect(result).toBe(true);
  });

  it('allows access when the admin has the required permission', async () => {
    mockReflector.getAllAndOverride.mockReturnValue('tenants:write');
    const result = await guard.canActivate(
      buildContext(mockAdmin(['tenants:read', 'tenants:write'])),
    );
    expect(result).toBe(true);
  });

  it('throws ForbiddenException when the admin lacks the required permission', async () => {
    mockReflector.getAllAndOverride.mockReturnValue('tenants:write');
    await expect(
      guard.canActivate(buildContext(mockAdmin(['tenants:read']))),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when the admin has no permissions at all', async () => {
    mockReflector.getAllAndOverride.mockReturnValue('platform_admins:write');
    await expect(
      guard.canActivate(buildContext(mockAdmin([]))),
    ).rejects.toThrow(ForbiddenException);
  });
});
