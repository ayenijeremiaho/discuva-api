import { AdminGuard } from './admin.guard';
import { AdminAccessService } from '../service/admin-access.service';
import { AdminPermission as P } from '../enum/admin-permission.enum';
import { SessionSurface } from '../../auth/enum/session-surface.enum';

function setup(surface = SessionSurface.ADMIN) {
  const admin = {
    id: 'admin',
    isActive: true,
    adminRole: { permissions: [] },
    additionalPermissions: [P.MEMBERS_READ],
    member: { password: 'secret', deviceId: 'device' },
  };
  const repo = { findOne: jest.fn().mockResolvedValue(admin) };
  const access = new AdminAccessService(
    { getNumber: async () => 2 } as never,
    {} as never,
    { isActive: () => false } as never,
  );
  const reflector = {
    getAllAndOverride: jest
      .fn()
      .mockReturnValueOnce(P.MEMBERS_READ)
      .mockReturnValueOnce(false),
  };
  const guard = new AdminGuard(reflector as never, access, repo as never);
  const request = {
    user: { id: 'member', surface },
    admin: undefined as unknown,
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => null,
    getClass: () => null,
  };
  return { guard, context, request, repo, admin };
}
describe('AdminGuard with individual grants', () => {
  it('authorises effective permission and strips member secrets without mutating the role', async () => {
    const { guard, context, request, admin } = setup();
    expect(await guard.canActivate(context as never)).toBe(true);
    expect(request.admin).toBe(admin);
    expect(admin.adminRole.permissions).toEqual([]);
    expect(admin.member).not.toHaveProperty('password');
    expect(admin.member).not.toHaveProperty('deviceId');
  });
  it('never uses an individual grant to accept a member-app token', async () => {
    const { guard, context, repo } = setup(SessionSurface.MEMBER);
    await expect(guard.canActivate(context as never)).rejects.toThrow(
      'admin token',
    );
    expect(repo.findOne).not.toHaveBeenCalled();
  });
});
