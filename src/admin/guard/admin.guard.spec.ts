import { ForbiddenException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { AdminPermission } from '../enum/admin-permission.enum';
import { SessionSurface } from '../../auth/enum/session-surface.enum';
import { REQUIRES_PERMISSION_KEY } from '../decorator/requires-permission.decorator';
import {
  CHURCH_WIDE_ONLY_KEY,
  SCOPED_MEMBER_PARAM_KEY,
} from '../../campus/campus-scope';

describe('AdminGuard campus limits', () => {
  const MEMBER = '11111111-1111-4111-8111-111111111111';
  let meta: Record<string, unknown>;
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => meta[key]),
  };
  const repo = { findOne: jest.fn(), query: jest.fn() };
  const cls = { isActive: () => true, set: jest.fn() };
  const guard = new AdminGuard(reflector as any, repo as any, cls as any);
  let request: any;
  const context = () =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => null,
      getClass: () => null,
    }) as any;
  const admin = (isOwner = false) => ({
    id: 'a1',
    isOwner,
    adminRole: {
      permissions: [AdminPermission.MEMBERS_READ, AdminPermission.BILLING_READ],
    },
    member: { id: 'me' },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    meta = {};
    request = {
      user: { id: 'me', surface: SessionSurface.ADMIN },
      params: {},
    };
  });

  it('caps a campus admin’s role at people-level permissions', async () => {
    repo.findOne.mockResolvedValue(admin());
    repo.query.mockResolvedValueOnce([{ campusId: 'c1' }]);
    meta[REQUIRES_PERMISSION_KEY] = AdminPermission.BILLING_READ;
    await expect(guard.canActivate(context())).rejects.toThrow(
      'Missing required permission: billing:read',
    );
    expect(cls.set).toHaveBeenCalledWith('campusScope', ['c1']);
  });

  it('leaves church-wide admins and owners as their role says', async () => {
    repo.findOne.mockResolvedValue(admin());
    repo.query.mockResolvedValueOnce([]);
    meta[REQUIRES_PERMISSION_KEY] = AdminPermission.BILLING_READ;
    await expect(guard.canActivate(context())).resolves.toBe(true);

    repo.findOne.mockResolvedValue(admin(true));
    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(repo.query).toHaveBeenCalledTimes(1);
  });

  it('keeps bulk exports and imports for church-wide admins', async () => {
    repo.findOne.mockResolvedValue(admin());
    repo.query.mockResolvedValueOnce([{ campusId: 'c1' }]);
    meta[CHURCH_WIDE_ONLY_KEY] = true;
    await expect(guard.canActivate(context())).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses acting on a person from another campus', async () => {
    repo.findOne.mockResolvedValue(admin());
    repo.query
      .mockResolvedValueOnce([{ campusId: 'c1' }])
      .mockResolvedValueOnce([{ campusId: 'c2' }]);
    meta[SCOPED_MEMBER_PARAM_KEY] = 'id';
    request.params.id = MEMBER;
    await expect(guard.canActivate(context())).rejects.toThrow(
      'belongs to another campus',
    );
  });

  it('allows their own campus and people with no campus yet', async () => {
    meta[SCOPED_MEMBER_PARAM_KEY] = 'id';
    request.params.id = MEMBER;
    for (const campusId of ['c1', null]) {
      repo.findOne.mockResolvedValue(admin());
      repo.query
        .mockResolvedValueOnce([{ campusId: 'c1' }])
        .mockResolvedValueOnce([{ campusId }]);
      await expect(guard.canActivate(context())).resolves.toBe(true);
    }
  });
});
