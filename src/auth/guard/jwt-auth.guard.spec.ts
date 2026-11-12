import { ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { RolesGuard } from './roles.guard';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { SessionSurface } from '../enum/session-surface.enum';

describe('JwtAuthGuard', () => {
  const guards: unknown[] = [];
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(false),
    getAllAndMerge: jest.fn((key: string) =>
      key === GUARDS_METADATA ? guards : [],
    ),
  };
  const overseers = {
    assertReadOnly: jest.fn().mockResolvedValue(undefined),
    recordView: jest.fn().mockResolvedValue(undefined),
  };
  const guard = new JwtAuthGuard(reflector as never, overseers as never);
  const request: { user?: unknown; method?: string } = {};
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as never;

  beforeAll(() => {
    jest
      .spyOn(AuthGuard('jwt').prototype, 'canActivate')
      .mockResolvedValue(true);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    guards.length = 0;
    request.user = { id: 'ov-1', surface: SessionSurface.OVERSEER };
  });

  it("refuses an overseer's pass on worker and team routes", async () => {
    guards.push(RolesGuard);
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    expect(overseers.recordView).not.toHaveBeenCalled();
  });

  it('lets it read what any member of the branch can, read-only and logged', async () => {
    guards.push(ModuleEnabledGuard);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(overseers.assertReadOnly).toHaveBeenCalledWith(request);
    expect(overseers.recordView).toHaveBeenCalled();
  });

  it('lets it through to admin routes, where AdminGuard decides', async () => {
    guards.push(AdminGuard);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('leaves ordinary sessions alone', async () => {
    request.user = { id: 'm-1', surface: SessionSurface.MEMBER };
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
