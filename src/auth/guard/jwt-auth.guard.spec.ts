import { ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AdminGuard } from '../../admin/guard/admin.guard';
import { SessionSurface } from '../enum/session-surface.enum';

describe('JwtAuthGuard', () => {
  const guards: unknown[] = [];
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(false),
    getAllAndMerge: jest.fn((key: string) =>
      key === GUARDS_METADATA ? guards : [],
    ),
  };
  const guard = new JwtAuthGuard(reflector as never);
  const request: { user?: unknown } = {};
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
    guards.length = 0;
    request.user = { id: 'ov-1', surface: SessionSurface.OVERSEER };
  });

  it("refuses an overseer's pass on member and worker routes", async () => {
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
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
