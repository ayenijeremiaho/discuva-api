import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminGuard } from './admin.guard';
import { SessionSurface } from '../../auth/enum/session-surface.enum';
import { AdminPermission } from '../enum/admin-permission.enum';
import { REQUIRES_PERMISSION_KEY } from '../decorator/requires-permission.decorator';
import { REQUIRES_OWNER_KEY } from '../decorator/requires-owner.decorator';
import { OPEN_TO_OVERSEERS } from '../../network-overseer/open-to-overseers.decorator';

describe('AdminGuard for overseers', () => {
  const meta: Record<string, unknown> = {};
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => meta[key]),
  } as unknown as Reflector;
  const access = {
    assertReadOnly: jest.fn().mockResolvedValue(undefined),
    adminFor: jest.fn().mockResolvedValue({
      isOwner: false,
      adminRole: { permissions: [AdminPermission.MEMBERS_READ] },
    }),
    recordView: jest.fn().mockResolvedValue(undefined),
  };
  const repo = { findOne: jest.fn() };
  const guard = new AdminGuard(reflector, repo as never, access as never);
  const user = {
    id: 'ov-1',
    surface: SessionSurface.OVERSEER,
    overseer: { id: 'ov-1', name: 'Ada Obi' },
  };
  const request: Record<string, unknown> = {};
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as never;

  beforeEach(() => {
    jest.clearAllMocks();
    for (const k of Object.keys(meta)) delete meta[k];
    Object.assign(request, { user, method: 'GET', admin: undefined });
  });

  it('opens a page within the Overseer role and logs it', async () => {
    meta[REQUIRES_PERMISSION_KEY] = AdminPermission.MEMBERS_READ;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(access.recordView).toHaveBeenCalledWith(user, request);
    expect(request.admin).toBeDefined();
    expect(repo.findOne).not.toHaveBeenCalled();
  });

  it('refuses anything outside the role, like prayer requests', async () => {
    meta[REQUIRES_PERMISSION_KEY] = AdminPermission.PRAYER_READ;
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    expect(access.recordView).not.toHaveBeenCalled();
  });

  it('refuses owner-only pages', async () => {
    meta[REQUIRES_OWNER_KEY] = true;
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      'Only an account owner can do this.',
    );
  });

  it('refuses pages with no permission unless they are marked open', async () => {
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    meta[OPEN_TO_OVERSEERS] = true;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('refuses a change before anything else', async () => {
    access.assertReadOnly.mockRejectedValueOnce(new ForbiddenException());
    request.method = 'PATCH';
    meta[REQUIRES_PERMISSION_KEY] = AdminPermission.MEMBERS_READ;
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    expect(access.adminFor).not.toHaveBeenCalled();
  });
});
