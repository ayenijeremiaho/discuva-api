import { NetworkCopyService } from './network-copy.service';

jest.mock('../../announcement/service/announcement.service', () => ({
  AnnouncementService: class {},
}));
jest.mock('../../tenant/utility/run-in-tenant-context', () => ({
  runInTenantContext: (
    _c: unknown,
    _t: unknown,
    _e: unknown,
    fn: () => unknown,
  ) => fn(),
}));

const churches: Record<string, object> = {
  root: {
    id: 'root',
    schemaName: 's_root',
    networkRootId: 'root',
    isActive: true,
  },
  lagos: {
    id: 'lagos',
    schemaName: 's_lagos',
    networkRootId: 'root',
    isActive: true,
  },
  ikeja: {
    id: 'ikeja',
    schemaName: 's_ikeja',
    networkRootId: 'root',
    isActive: true,
  },
  solo: {
    id: 'solo',
    schemaName: 's_solo',
    networkRootId: null,
    isActive: true,
  },
};

function setup(
  announcement: object | null = {
    id: 'a1',
    title: 'Convention',
    sendToBranches: true,
  },
) {
  const tenantRepo = {
    findOne: jest.fn(async ({ where }) => churches[where.id] ?? null),
    find: jest.fn(async ({ where }) =>
      where.id._value.map((id: string) => churches[id]),
    ),
  };
  const venue = { name: 'Main Hall' };
  const eventRepo = {
    find: jest.fn().mockResolvedValue([
      {
        id: 'e1',
        name: 'Convention',
        description: 'x'.repeat(1200),
        startTime: new Date('2026-12-01T09:00:00Z'),
        endTime: new Date('2026-12-01T12:00:00Z'),
        audience: 'EVERYONE',
        sendToBranches: true,
        serviceSlots: [
          { venueOverride: null, config: { defaultVenue: venue } },
          { venueOverride: null, config: null },
        ],
      },
    ]),
  };
  const announcementRepo = {
    findOne: jest.fn().mockResolvedValue(announcement),
  };
  const em = { delete: jest.fn(), insert: jest.fn() };
  const dataSource = {
    transaction: jest.fn(async (fn: (e: typeof em) => unknown) => fn(em)),
    getRepository: jest.fn().mockReturnValue({ delete: jest.fn() }),
  };
  const tree = { rootId: 'root' };
  const network = {
    loadTree: jest.fn().mockResolvedValue(tree),
    subtreeIds: jest.fn((_t: unknown, id: string) =>
      id === 'root' ? ['root', 'lagos', 'ikeja'] : [id],
    ),
    pathsOf: jest.fn().mockResolvedValue(new Map([['root', 'ABC']])),
  };
  const announcements = {
    upsertNetworkCopy: jest.fn(),
    removeNetworkCopy: jest.fn(),
  };
  const service = new NetworkCopyService(
    tenantRepo as never,
    eventRepo as never,
    announcementRepo as never,
    dataSource as never,
    network as never,
    announcements as never,
    {} as never,
    {} as never,
  );
  return { service, em, dataSource, announcements };
}

describe('NetworkCopyService', () => {
  it("replaces a networked church's event copies with its current events", async () => {
    const t = setup();
    await t.service.copyEvents('lagos');
    expect(t.em.delete).toHaveBeenCalledWith(expect.anything(), {
      tenantId: 'lagos',
    });
    const [, rows] = t.em.insert.mock.calls[0];
    expect(rows).toEqual([
      expect.objectContaining({
        tenantId: 'lagos',
        eventId: 'e1',
        networkRootId: 'root',
        venueName: 'Main Hall',
        serviceCount: 2,
        shared: true,
      }),
    ]);
    expect(rows[0].description).toHaveLength(1000);
  });

  it('removes the copies of a church that left its network', async () => {
    const t = setup();
    await t.service.copyEvents('solo');
    expect(t.dataSource.getRepository().delete).toHaveBeenCalledWith({
      tenantId: 'solo',
    });
    expect(t.em.insert).not.toHaveBeenCalled();
  });

  it('copies a shared announcement to every church under the sender, not the sender', async () => {
    const t = setup();
    await t.service.copyAnnouncement('root', 'a1');
    expect(t.announcements.upsertNetworkCopy).toHaveBeenCalledTimes(2);
    expect(t.announcements.upsertNetworkCopy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a1' }),
      'root',
      'ABC',
    );
  });

  it('removes the copies once it is unshared or deleted', async () => {
    const t = setup(null);
    await t.service.copyAnnouncement('root', 'a1');
    expect(t.announcements.removeNetworkCopy).toHaveBeenCalledWith(
      'a1',
      'root',
    );
    expect(t.announcements.upsertNetworkCopy).not.toHaveBeenCalled();
  });

  it('carries on past a failing branch, then fails so the job retries', async () => {
    const t = setup();
    t.announcements.upsertNetworkCopy.mockRejectedValueOnce(new Error('down'));
    await expect(t.service.copyAnnouncement('root', 'a1')).rejects.toThrow(
      '1 of 2 branches failed',
    );
    expect(t.announcements.upsertNetworkCopy).toHaveBeenCalledTimes(2);
  });
});
