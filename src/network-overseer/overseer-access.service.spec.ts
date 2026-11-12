import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { OverseerAccessService } from './overseer-access.service';
import { SessionSurface } from '../auth/enum/session-surface.enum';
import { AdminPermission as P } from '../admin/enum/admin-permission.enum';
import { overseerPermissions } from './overseer.constants';

describe('OverseerAccessService', () => {
  const overseers = { findOne: jest.fn() };
  const tenants = { findOne: jest.fn() };
  const jwt = { signAsync: jest.fn().mockResolvedValue('signed') };
  const cache = {
    getGlobal: jest.fn().mockResolvedValue(undefined),
    setGlobal: jest.fn().mockResolvedValue(undefined),
    delGlobal: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
  };
  const audit = { log: jest.fn() };
  let here = 'branch-1';
  const cls = { get: jest.fn(() => here) };
  const tx = { query: jest.fn().mockResolvedValue(undefined) };
  const service = new OverseerAccessService(
    overseers as never,
    tenants as never,
    jwt as never,
    cache as never,
    audit as never,
    cls as never,
    { tx } as never,
  );
  const overseer = {
    id: 'ov-1',
    name: 'Ada Obi',
    email: 'ada@example.com',
    networkRootId: 'root',
  };
  const pass = {
    sub: 'ov-1',
    aud: SessionSurface.OVERSEER,
    jti: 'j',
    tenantId: 'branch-1',
  } as never;

  beforeEach(() => {
    jest.clearAllMocks();
    here = 'branch-1';
    overseers.findOne.mockResolvedValue(overseer);
    tenants.findOne.mockResolvedValue({
      id: 'branch-1',
      networkRootId: 'root',
      shareGivingWithParent: false,
    });
  });

  it('signs a 15-minute pass for one branch', async () => {
    const res = await service.issuePass('ov-1', {
      id: 'branch-1',
      schemaName: 'tenant_b1',
    });
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'ov-1',
        aud: SessionSurface.OVERSEER,
        tenantId: 'branch-1',
        schemaName: 'tenant_b1',
      }),
      { expiresIn: 900 },
    );
    expect(res).toEqual({
      access_token: 'signed',
      expires_in: 900,
      token_type: 'Bearer',
    });
  });

  it('accepts a pass at the branch it names', async () => {
    const user = await service.validatePass(pass);
    expect(user.surface).toBe(SessionSurface.OVERSEER);
    expect(user.overseer.name).toBe('Ada Obi');
  });

  it('refuses a pass at another church', async () => {
    here = 'branch-2';
    await expect(service.validatePass(pass)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('refuses once the overseer is removed', async () => {
    overseers.findOne.mockResolvedValue(null);
    await expect(service.validatePass(pass)).rejects.toThrow(
      'Your overseer access has ended.',
    );
  });

  it('refuses a branch outside their network', async () => {
    tenants.findOne.mockResolvedValue({
      id: 'branch-1',
      networkRootId: 'other',
      shareGivingWithParent: false,
    });
    await expect(service.validatePass(pass)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('stands in as a read-only admin without private areas or giving', async () => {
    const admin = await service.adminFor(await service.validatePass(pass));
    const perms = admin.adminRole.permissions;
    expect(admin.isOwner).toBe(false);
    expect(perms).toContain(P.MEMBERS_READ);
    expect(perms).toContain(P.ATTENDANCE_READ);
    expect(perms.some((p) => !p.endsWith(':read'))).toBe(false);
    for (const hidden of [
      P.PRAYER_READ,
      P.PASTOR_FEEDBACK_READ,
      P.FOLLOW_UP_READ,
      P.TITHE_READ,
      P.FINANCE_READ,
      P.BILLING_READ,
    ]) {
      expect(perms).not.toContain(hidden);
    }
  });

  it('shows giving when the branch shares it', () => {
    expect(overseerPermissions(true)).toEqual(
      expect.arrayContaining([P.TITHE_READ, P.FINANCE_READ]),
    );
    expect(overseerPermissions(true)).not.toContain(P.PRAYER_READ);
  });

  it('refuses changes and makes reads read-only in the database', async () => {
    await expect(
      service.assertReadOnly({ method: 'POST' } as never),
    ).rejects.toThrow(ForbiddenException);
    await service.assertReadOnly({ method: 'GET' } as never);
    expect(tx.query).toHaveBeenCalledWith(
      'SET LOCAL transaction_read_only = on',
    );
  });

  it("logs each page once per 10 minutes in the branch's audit log", async () => {
    const user = await service.validatePass(pass);
    await service.recordView(user, {
      originalUrl: '/v1/members/m-1?x=1',
    } as never);
    expect(cache.incr).toHaveBeenCalledWith(
      'overseer-view:ov-1:/v1/members/m-1',
      600,
    );
    expect(audit.log).toHaveBeenCalledWith('OVERSEER_VIEWED', {
      targetName: 'Ada Obi',
      targetEmail: 'ada@example.com',
      metadata: { overseerId: 'ov-1', path: '/v1/members/m-1' },
    });
    audit.log.mockClear();
    cache.incr.mockResolvedValue(2);
    await service.recordView(user, { originalUrl: '/v1/members/m-1' } as never);
    expect(audit.log).not.toHaveBeenCalled();
  });
});
