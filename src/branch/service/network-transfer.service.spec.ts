import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { NetworkTransferService } from './network-transfer.service';
import { NetworkTransferStatus } from '../entity/network-transfer.entity';
import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { SessionSurface } from '../../auth/enum/session-surface.enum';

jest.mock('../../tenant/utility/run-in-tenant-context', () => ({
  runInTenantContext: (
    _c: unknown,
    _t: unknown,
    _e: unknown,
    fn: () => unknown,
  ) => fn(),
}));

const ROOT = 'root-1';
const HERE = 'lekki';
const THERE = 'ikeja';

function setup(
  over: { role?: MemberRoleEnum; links?: any[]; admin?: boolean } = {},
) {
  const member = {
    id: 'm-1',
    firstname: 'ada',
    lastname: 'Obi',
    email: 'ada@x.test',
    role: over.role ?? MemberRoleEnum.MEMBER,
    discuvaAccountId: 'acc-1',
    deviceId: 'dev-1',
    dateJoinedChurch: new Date('2019-03-01'),
    createdAt: new Date('2020-01-01'),
  };
  const transferRepo = {
    create: jest.fn((x) => ({ ...x })),
    save: jest.fn(async (x) => x),
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const tenantRepo = {
    findOne: jest.fn(async ({ where }) =>
      where.id === HERE
        ? { id: HERE, networkRootId: ROOT }
        : where.id === THERE
          ? { id: THERE, networkRootId: ROOT }
          : null,
    ),
    find: jest.fn().mockResolvedValue([
      {
        id: HERE,
        schemaName: 's_lekki',
        subdomain: 'abc-lekki',
        networkRootId: ROOT,
      },
      {
        id: THERE,
        schemaName: 's_ikeja',
        subdomain: 'abc-ikeja',
        networkRootId: ROOT,
      },
    ]),
  };
  const qb: any = {
    innerJoin: () => qb,
    leftJoin: () => qb,
    select: () => qb,
    where: () => qb,
    getMany: jest
      .fn()
      .mockResolvedValue([
        { isOwner: true, member: { email: 'owner@x.test' } },
      ]),
  };
  const adminRepo = {
    exists: jest.fn().mockResolvedValue(!!over.admin),
    createQueryBuilder: () => qb,
  };
  const network = {
    isAvailable: jest.fn().mockResolvedValue(true),
    pathsOf: jest.fn().mockResolvedValue(
      new Map([
        [HERE, 'ABC · Lekki'],
        [THERE, 'ABC · Ikeja'],
      ]),
    ),
  };
  const accounts = {
    findById: jest.fn().mockResolvedValue({
      id: 'acc-1',
      email: 'ada@x.test',
      password: 'hash',
    }),
    linkHere: jest.fn().mockResolvedValue({ consentedAt: new Date() }),
    linksOf: jest
      .fn()
      .mockResolvedValue(over.links ?? [{ tenantId: HERE, memberId: 'm-1' }]),
    link: jest.fn(),
    setHome: jest.fn(),
  };
  const profiles = {
    ownerOf: jest.fn().mockResolvedValue(null),
    reconcile: jest.fn(),
  };
  const memberService = {
    getById: jest.fn().mockResolvedValue(member),
    getByIdWithCredentials: jest.fn().mockResolvedValue(member),
    createFromTransfer: jest.fn().mockResolvedValue({ id: 'm-new' }),
    welcomeBack: jest.fn().mockResolvedValue({ id: 'm-old-there' }),
    markTransferred: jest.fn(),
    findByIds: jest.fn().mockResolvedValue([member]),
  };
  const sessions = { updateLogout: jest.fn() };
  const push = {
    subscriptionOf: jest
      .fn()
      .mockResolvedValue({ endpoint: 'e', p256dh: 'p', auth: 'a' }),
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
  };
  const signIn = {
    switchChurch: jest
      .fn()
      .mockResolvedValue({ subdomain: 'abc-ikeja', token: 'tok' }),
  };
  const utility = { sendEmailWithTemplate: jest.fn() };
  const auditLog = { log: jest.fn() };
  const cls = { get: jest.fn().mockReturnValue(HERE) };
  const service = new NetworkTransferService(
    transferRepo as any,
    tenantRepo as any,
    adminRepo as any,
    network as any,
    accounts as any,
    profiles as any,
    memberService as any,
    sessions as any,
    push as any,
    signIn as any,
    utility as any,
    auditLog as any,
    cls as any,
    {} as any,
  );
  return {
    service,
    transferRepo,
    accounts,
    memberService,
    push,
    sessions,
    signIn,
    utility,
  };
}

describe('NetworkTransferService', () => {
  it('moves a member at once and hands the app to the new branch', async () => {
    const t = setup();
    const result = await t.service.request('m-1', THERE);

    expect(result).toEqual({
      status: 'MOVED',
      subdomain: 'abc-ikeja',
      token: 'tok',
    });
    expect(t.memberService.createFromTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'm-1' }),
      expect.objectContaining({ id: 'acc-1' }),
      'dev-1',
      new Date('2019-03-01'),
    );
    expect(t.accounts.link).toHaveBeenCalledWith('acc-1', 'm-new', true);
    expect(t.accounts.setHome).toHaveBeenCalledWith('acc-1', ROOT, THERE);
    expect(t.push.subscribe).toHaveBeenCalledWith('m-new', {
      endpoint: 'e',
      p256dh: 'p',
      auth: 'a',
    });
    expect(t.memberService.markTransferred).toHaveBeenCalledWith('m-1', THERE);
    expect(t.push.unsubscribe).toHaveBeenCalledWith('m-1');
    expect(t.sessions.updateLogout).toHaveBeenCalledWith(
      'm-1',
      SessionSurface.MEMBER,
    );
    expect(t.transferRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: NetworkTransferStatus.DONE,
        toMemberId: 'm-new',
      }),
    );
    const templates = t.utility.sendEmailWithTemplate.mock.calls.map(
      (c) => c[2],
    );
    expect(templates).toEqual(
      expect.arrayContaining([
        'network-transfer-moved',
        'network-transfer-arrived',
        'network-transfer-left',
      ]),
    );
  });

  it('creates the new record before marking the old one', async () => {
    const t = setup();
    await t.service.request('m-1', THERE);
    expect(
      t.memberService.createFromTransfer.mock.invocationCallOrder[0],
    ).toBeLessThan(t.memberService.markTransferred.mock.invocationCallOrder[0]);
  });

  it('reuses their record when they belonged to that branch before', async () => {
    const t = setup({
      links: [
        { tenantId: HERE, memberId: 'm-1' },
        { tenantId: THERE, memberId: 'm-old-there' },
      ],
    });
    await t.service.request('m-1', THERE);
    expect(t.memberService.welcomeBack).toHaveBeenCalledWith('m-old-there');
    expect(t.memberService.createFromTransfer).not.toHaveBeenCalled();
    expect(t.accounts.link).not.toHaveBeenCalled();
  });

  it('asks the branch to release a worker instead of moving them', async () => {
    const t = setup({ role: MemberRoleEnum.WORKER });
    const result = await t.service.request('m-1', THERE);
    expect(result).toEqual({ status: 'REQUESTED' });
    expect(t.transferRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: NetworkTransferStatus.PENDING,
        needsRelease: true,
      }),
    );
    expect(t.memberService.markTransferred).not.toHaveBeenCalled();
    expect(t.utility.sendEmailWithTemplate).toHaveBeenCalledWith(
      'owner@x.test',
      expect.any(String),
      'network-transfer-request',
      expect.objectContaining({ to_church: 'ABC · Ikeja' }),
    );
  });

  it('refuses admins, the same branch, and branches outside the network', async () => {
    await expect(
      setup({ admin: true }).service.request('m-1', THERE),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(setup().service.request('m-1', HERE)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      setup().service.request('m-1', 'elsewhere'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a second request while one is waiting', async () => {
    const t = setup();
    t.transferRepo.findOne.mockResolvedValue({ id: 'x' });
    await expect(t.service.request('m-1', THERE)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('explains when the new branch already has a record with that email', async () => {
    const t = setup();
    t.memberService.createFromTransfer.mockRejectedValue(
      new ConflictException('taken'),
    );
    await expect(t.service.request('m-1', THERE)).rejects.toThrow(
      /ABC · Ikeja already has a record/,
    );
    expect(t.memberService.markTransferred).not.toHaveBeenCalled();
  });

  it("won't let a worker release themselves", async () => {
    const t = setup();
    t.transferRepo.findOne.mockResolvedValue({
      id: 'r-1',
      fromMemberId: 'm-1',
    });
    await expect(t.service.release('r-1', 'm-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('declines with a note and tells the member', async () => {
    const t = setup();
    t.transferRepo.findOne.mockResolvedValue({
      id: 'r-1',
      fromMemberId: 'm-1',
      accountId: 'acc-1',
      networkRootId: ROOT,
      toTenantId: THERE,
    });
    await t.service.decline('r-1', 'admin-1', ' Finish the quarter first ');
    expect(t.transferRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: NetworkTransferStatus.DECLINED,
        declineReason: 'Finish the quarter first',
        decidedByMemberId: 'admin-1',
      }),
    );
    expect(t.utility.sendEmailWithTemplate).toHaveBeenCalledWith(
      'ada@x.test',
      expect.any(String),
      'network-transfer-declined',
      expect.objectContaining({ note: 'Finish the quarter first' }),
    );
  });
});
