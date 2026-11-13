import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { NetworkClosureService } from './network-closure.service';
import { BranchClosureStatus } from '../entity/branch-closure.entity';

jest.mock('../../tenant/utility/run-in-tenant-context', () => ({
  runInTenantContext: (
    _c: unknown,
    _t: unknown,
    _e: unknown,
    fn: () => unknown,
  ) => fn(),
}));
jest.mock('../../announcement/service/announcement.service', () => ({
  AnnouncementService: class {},
}));
jest.mock('../../follow-up/service/follow-up.service', () => ({
  FollowUpService: class {},
}));

const day = (n: number) =>
  new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const owner = { isOwner: true } as never;

function setup(over: { children?: string[]; existing?: boolean } = {}) {
  const byId = new Map([
    ['root', { isActive: true }],
    ['lekki', { isActive: true }],
    ['ikeja', { isActive: true }],
    ['ajah', { isActive: true }],
  ]);
  const children = new Map([
    ['root', ['lekki', 'ikeja']],
    ['lekki', over.children ?? []],
  ]);
  const tree = { byId, children };
  const closureRepo = {
    exists: jest.fn().mockResolvedValue(!!over.existing),
    query: jest
      .fn()
      .mockResolvedValue([{ run_at: new Date(Date.now() + 20 * 864e5) }]),
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({
      id: 'cl1',
      createdAt: new Date(),
      summary: null,
      ...x,
    })),
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const tenantRepo = {
    findOne: jest.fn(async ({ where }) =>
      where.id === 'root' || !where.id
        ? { id: 'root', networkRootId: 'root' }
        : {
            id: where.id,
            schemaName: `s_${where.id}`,
            networkRootId: 'root',
            timezone: 'UTC',
            isActive: true,
          },
    ),
    update: jest.fn(),
  };
  const memberRepo = {
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  };
  const queue = {
    add: jest.fn(),
    getJob: jest.fn().mockResolvedValue({ remove: jest.fn() }),
  };
  const network = {
    isAvailable: jest.fn().mockResolvedValue(true),
    loadTree: jest.fn().mockResolvedValue(tree),
    subtreeIds: jest.fn((_t: unknown, id: string) =>
      id === 'root' ? ['root', 'lekki', 'ikeja', 'ajah'] : [id],
    ),
    pathsOf: jest.fn().mockResolvedValue(
      new Map([
        ['lekki', 'ABC · Lekki'],
        ['ikeja', 'ABC · Ikeja'],
      ]),
    ),
    forgetPublicNetwork: jest.fn(),
  };
  const settings = {
    get: jest
      .fn()
      .mockResolvedValue({ closureNoticeDays: 14, firstTimerHandoverDays: 90 }),
  };
  const announcements = { createSystemAnnouncement: jest.fn() };
  const utility = { sendEmailWithTemplate: jest.fn() };
  const cls = { get: jest.fn().mockReturnValue('root') };
  const service = new NetworkClosureService(
    closureRepo as never,
    tenantRepo as never,
    memberRepo as never,
    {} as never,
    {} as never,
    {} as never,
    queue as never,
    network as never,
    settings as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    announcements as never,
    {} as never,
    {} as never,
    {} as never,
    utility as never,
    { log: jest.fn() } as never,
    cls as never,
    {} as never,
    accounts as never,
  );
  return { service, closureRepo, queue, announcements, accounts };
}

const accounts = { isNetworkOnFor: jest.fn().mockResolvedValue(true) };

describe('NetworkClosureService', () => {
  it('schedules a closing with one job set for the date, and tells members', async () => {
    const t = setup();
    const view = await t.service.schedule(owner, 'm1', {
      tenantId: 'lekki',
      destinationTenantId: 'ikeja',
      closesOn: day(20),
    });
    expect(view).toEqual(
      expect.objectContaining({
        status: BranchClosureStatus.SCHEDULED,
        destinationPath: 'ABC · Ikeja',
      }),
    );
    expect(t.queue.add).toHaveBeenCalledWith(
      { kind: 'closure', sourceTenantId: 'lekki', sourceId: 'cl1' },
      expect.objectContaining({ jobId: 'closure:cl1' }),
    );
    expect(t.announcements.createSystemAnnouncement).toHaveBeenCalledWith(
      expect.stringMatching(/^Lekki is closing on /),
      expect.any(String),
    );
  });

  it('refuses a date inside the notice period, or more than a year out', async () => {
    const t = setup();
    await expect(
      t.service.schedule(owner, 'm1', {
        tenantId: 'lekki',
        destinationTenantId: 'ikeja',
        closesOn: day(10),
      }),
    ).rejects.toThrow(/at least 14 days/);
    await expect(
      t.service.schedule(owner, 'm1', {
        tenantId: 'lekki',
        destinationTenantId: 'ikeja',
        closesOn: day(400),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses non-owners, your own church, branches with branches, a closed destination, and a second date', async () => {
    await expect(
      setup().service.schedule({ isOwner: false } as never, 'm1', {
        tenantId: 'lekki',
        destinationTenantId: 'ikeja',
        closesOn: day(20),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      setup().service.schedule(owner, 'm1', {
        tenantId: 'root',
        destinationTenantId: 'ikeja',
        closesOn: day(20),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      setup({ children: ['ajah'] }).service.schedule(owner, 'm1', {
        tenantId: 'lekki',
        destinationTenantId: 'ikeja',
        closesOn: day(20),
      }),
    ).rejects.toThrow(/branches under it first/);
    await expect(
      setup().service.schedule(owner, 'm1', {
        tenantId: 'lekki',
        destinationTenantId: 'lekki',
        closesOn: day(20),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      setup({ existing: true }).service.schedule(owner, 'm1', {
        tenantId: 'lekki',
        destinationTenantId: 'ikeja',
        closesOn: day(20),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('cancels before the date: removes the job and tells members the branch stays open', async () => {
    const t = setup();
    t.closureRepo.findOne.mockResolvedValue({
      id: 'cl1',
      tenantId: 'lekki',
      status: BranchClosureStatus.SCHEDULED,
    });
    await t.service.cancel(owner, 'm1', 'cl1');
    expect(t.closureRepo.update).toHaveBeenCalledWith(
      { id: 'cl1', status: BranchClosureStatus.SCHEDULED },
      expect.objectContaining({ status: BranchClosureStatus.CANCELLED }),
    );
    expect(t.queue.getJob).toHaveBeenCalledWith('closure:cl1');
    expect(t.announcements.createSystemAnnouncement).toHaveBeenCalledWith(
      'Lekki is staying open',
      expect.any(String),
      'm1',
    );
  });

  it("can't be cancelled once the day has started it", async () => {
    const t = setup();
    t.closureRepo.findOne.mockResolvedValue({
      id: 'cl1',
      tenantId: 'lekki',
      status: BranchClosureStatus.SCHEDULED,
    });
    t.closureRepo.update.mockResolvedValueOnce({ affected: 0 });
    await expect(t.service.cancel(owner, 'm1', 'cl1')).rejects.toThrow(
      'already closing',
    );
    expect(t.announcements.createSystemAnnouncement).not.toHaveBeenCalled();
  });

  it('does nothing for a closing that was cancelled or already ran', async () => {
    const t = setup();
    t.closureRepo.findOne.mockResolvedValue({
      id: 'cl1',
      status: BranchClosureStatus.CANCELLED,
    });
    await t.service.run('cl1');
    expect(t.closureRepo.save).not.toHaveBeenCalled();
  });

  it('queues anything overdue that never ran', async () => {
    const t = setup();
    t.closureRepo.find.mockResolvedValue([{ id: 'cl9', tenantId: 'lekki' }]);
    expect(await t.service.queueOverdue()).toBe(1);
    expect(t.queue.add).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'cl9' }),
      expect.objectContaining({ jobId: 'closure:cl9' }),
    );
  });
});
