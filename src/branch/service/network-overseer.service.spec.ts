import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { NetworkOverseerService } from './network-overseer.service';
import { TenantOnboardingStatus } from '../../tenant/enum/tenant-onboarding-status.enum';

describe('NetworkOverseerService', () => {
  const overseers = {
    find: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const tenants = { findOne: jest.fn() };
  const admins = { find: jest.fn(), findOne: jest.fn() };
  const access = {
    issuePass: jest.fn().mockResolvedValue({ access_token: 'pass' }),
    forget: jest.fn().mockResolvedValue(undefined),
  };
  const network = {
    pathsOf: jest.fn().mockResolvedValue(new Map([['b1', 'ABC · Ikeja']])),
  };
  const audit = { log: jest.fn() };
  let here = 'root';
  const cls = { get: jest.fn(() => here) };
  const service = new NetworkOverseerService(
    overseers as never,
    tenants as never,
    admins as never,
    access as never,
    network as never,
    audit as never,
    cls as never,
  );
  const owner = {
    id: 'a-owner',
    isOwner: true,
    member: { id: 'm-owner', firstname: 'Olu', lastname: 'Ade' },
  } as never;
  const plain = {
    id: 'a-2',
    isOwner: false,
    member: { id: 'm-2', firstname: 'Ada', lastname: 'Obi' },
  } as never;
  const insert = { raw: [{ id: 'ov-1' }] };
  const qb = {
    insert: () => qb,
    values: jest.fn(() => qb),
    orIgnore: () => qb,
    returning: () => qb,
    execute: jest.fn(() => Promise.resolve(insert)),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    here = 'root';
    insert.raw = [{ id: 'ov-1' }];
    tenants.findOne.mockImplementation(({ where }) =>
      Promise.resolve(
        where.id === 'b1'
          ? {
              id: 'b1',
              name: 'Ikeja',
              subdomain: 'abc-ikeja',
              schemaName: 'tenant_b1',
              isActive: true,
              closedAt: null,
              onboardingStatus: TenantOnboardingStatus.ACTIVE,
            }
          : { id: here, networkRootId: 'root' },
      ),
    );
    overseers.find.mockResolvedValue([]);
    overseers.count.mockResolvedValue(0);
    overseers.createQueryBuilder.mockReturnValue(qb);
    admins.find.mockResolvedValue([
      {
        id: 'a-2',
        member: {
          id: 'm-2',
          firstname: 'Ada',
          lastname: 'Obi',
          email: 'a@x.co',
        },
      },
    ]);
    admins.findOne.mockResolvedValue({
      id: 'a-2',
      member: { id: 'm-2', firstname: 'Ada', lastname: 'Obi', email: 'a@x.co' },
    });
  });

  it('offers the top church owners its admins to name', async () => {
    const view = await service.view(owner);
    expect(view.canManage).toBe(true);
    expect(view.candidates).toEqual([
      { adminId: 'a-2', name: 'Ada Obi', email: 'a@x.co' },
    ]);
  });

  it('shows branches who can look in, but nothing to manage', async () => {
    here = 'b2';
    overseers.find.mockResolvedValue([
      { id: 'ov-1', memberId: 'm-2', name: 'Ada Obi' },
    ]);
    const view = await service.view(owner);
    expect(view.canManage).toBe(false);
    expect(view.youAreOverseer).toBe(false);
    expect(view.candidates).toEqual([]);
    expect(view.overseers[0]).not.toHaveProperty('memberId');
  });

  it('names an overseer and logs it', async () => {
    await service.add(owner, 'a-2');
    expect(qb.values).toHaveBeenCalledWith({
      networkRootId: 'root',
      memberId: 'm-2',
      name: 'Ada Obi',
      email: 'a@x.co',
      addedByName: 'Olu Ade',
    });
    expect(audit.log).toHaveBeenCalledWith(
      'NETWORK_OVERSEER_ADDED',
      expect.objectContaining({ targetId: 'm-2' }),
    );
  });

  it('allows at most 5', async () => {
    overseers.count.mockResolvedValue(5);
    await expect(service.add(owner, 'a-2')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses someone already named', async () => {
    insert.raw = [];
    await expect(service.add(owner, 'a-2')).rejects.toThrow(ConflictException);
  });

  it('only owners of the top church name overseers', async () => {
    await expect(service.add(plain, 'a-2')).rejects.toThrow(ForbiddenException);
    here = 'b2';
    await expect(service.add(owner, 'a-2')).rejects.toThrow(ForbiddenException);
  });

  it('lets an overseer step down, and ends their passes at once', async () => {
    overseers.findOne.mockResolvedValue({
      id: 'ov-1',
      memberId: 'm-2',
      name: 'Ada Obi',
    });
    await service.remove(plain, 'ov-1');
    expect(overseers.delete).toHaveBeenCalledWith({ id: 'ov-1' });
    expect(access.forget).toHaveBeenCalledWith('ov-1');
  });

  it("doesn't let another admin remove someone", async () => {
    overseers.findOne.mockResolvedValue({ id: 'ov-1', memberId: 'm-9' });
    await expect(service.remove(plain, 'ov-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('gives an overseer a pass for a branch', async () => {
    overseers.findOne.mockResolvedValue({ id: 'ov-1' });
    const res = await service.pass(plain, 'b1');
    expect(access.issuePass).toHaveBeenCalledWith(
      'ov-1',
      expect.objectContaining({ id: 'b1', schemaName: 'tenant_b1' }),
    );
    expect(res.branch).toEqual(
      expect.objectContaining({ id: 'b1', path: 'ABC · Ikeja' }),
    );
  });

  it('refuses a pass to anyone who is not an overseer', async () => {
    overseers.findOne.mockResolvedValue(null);
    await expect(service.pass(plain, 'b1')).rejects.toThrow(ForbiddenException);
  });

  it('refuses a pass for the top church itself or another network', async () => {
    overseers.findOne.mockResolvedValue({ id: 'ov-1' });
    await expect(service.pass(plain, 'root')).rejects.toThrow(
      NotFoundException,
    );
    tenants.findOne.mockResolvedValueOnce({
      id: 'root',
      networkRootId: 'root',
    });
    tenants.findOne.mockResolvedValueOnce(null);
    await expect(service.pass(plain, 'elsewhere')).rejects.toThrow(
      NotFoundException,
    );
  });
});
