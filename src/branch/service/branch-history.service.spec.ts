import { NotFoundException } from '@nestjs/common';
import { BranchHistoryService } from './branch-history.service';

jest.mock('../../tenant/utility/run-in-tenant-context', () => ({
  runInTenantContext: (
    _c: unknown,
    _t: unknown,
    _e: unknown,
    fn: () => unknown,
  ) => fn(),
}));

const HERE = 'ikeja';
const move = (
  from: string,
  at: string,
  to = 'elsewhere',
  fromMemberId = `old-${from}`,
) => ({
  networkRootId: 'root',
  fromTenantId: from,
  toTenantId: to,
  fromMemberId,
  decidedAt: new Date(at),
});

function setup(
  moves = [
    move('lekki', '2026-11-09', HERE),
    move(HERE, '2026-06-01', 'lekki'),
    move('lekki', '2025-01-01', HERE),
  ],
) {
  const transferRepo = { find: jest.fn().mockResolvedValue(moves) };
  const tenantRepo = {
    findOne: jest.fn().mockResolvedValue({
      id: 'lekki',
      schemaName: 'church_lekki',
      currency: 'NGN',
      isActive: true,
      closedAt: null,
    }),
  };
  const network = {
    pathsOf: jest.fn().mockResolvedValue(
      new Map([
        ['lekki', 'ABC · Lekki'],
        [HERE, 'ABC · Ikeja'],
      ]),
    ),
  };
  const memberService = {
    getById: jest.fn<Promise<any>, [string]>(async (id: string) =>
      id === 'me'
        ? { id: 'me', discuvaAccountId: 'acc' }
        : {
            id,
            status: 'TRANSFERRED',
            dateJoinedChurch: '2019-03-01',
            transferredAt: new Date('2026-11-09'),
          },
    ),
  };
  const giving = {
    year: 2026,
    years: [2026],
    total: 5000,
    count: 2,
    byType: [],
  };
  const tithes = {
    getMyGivingSummary: jest.fn().mockResolvedValue(giving),
    emailGivingStatement: jest
      .fn()
      .mockResolvedValue({ message: 'sent', recordCount: 2 }),
  };
  const cache = {
    getGlobal: jest.fn().mockResolvedValue(undefined),
    setGlobal: jest.fn(),
  };
  const dataSource = {
    query: jest.fn().mockResolvedValue([
      { year: 2026, count: 30, last: '2026-11-02T09:00:00Z' },
      { year: 2025, count: 48, last: '2025-12-28T09:00:00Z' },
    ]),
  };
  const cls = { get: jest.fn().mockReturnValue(HERE) };
  const service = new BranchHistoryService(
    transferRepo as any,
    tenantRepo as any,
    network as any,
    memberService as any,
    tithes as any,
    cache as any,
    dataSource as any,
    cls as any,
    {} as any,
  );
  return { service, tithes, cache, dataSource, memberService };
}

describe('BranchHistoryService', () => {
  it('lists each branch they left once, newest move, never the branch they are in', async () => {
    const list = await setup().service.list('me');
    expect(list).toEqual([
      {
        tenantId: 'lekki',
        path: 'ABC · Lekki',
        movedAt: new Date('2026-11-09'),
      },
    ]);
  });

  it('reads attendance and giving from their old record there, and caches it', async () => {
    const t = setup();
    const h = await t.service.detail('me', 'lekki', 2026);
    expect(h.attendance).toEqual({
      total: 78,
      last: '2026-11-02T09:00:00.000Z',
      byYear: [
        { year: 2026, count: 30 },
        { year: 2025, count: 48 },
      ],
    });
    expect(h.stays).toEqual([
      { from: '2026-06-01', to: '2026-11-09' },
      { from: '2019-03-01', to: '2025-01-01' },
    ]);
    expect(t.dataSource.query.mock.calls[0][0]).toContain(
      '"church_lekki".attendances',
    );
    expect(t.tithes.getMyGivingSummary).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'old-lekki' }),
      2026,
    );
    expect(t.cache.setGlobal).toHaveBeenCalledWith(
      `branch-history:old-lekki:${new Date('2026-11-09').getTime()}:2026`,
      h,
      86400,
    );
  });

  it('answers from the cache without reading the old branch', async () => {
    const t = setup();
    t.cache.getGlobal.mockResolvedValue({ path: 'cached' });
    expect(await t.service.detail('me', 'lekki', 2026)).toEqual({
      path: 'cached',
    });
    expect(t.dataSource.query).not.toHaveBeenCalled();
  });

  it('refuses branches they never moved away from', async () => {
    await expect(setup().service.detail('me', 'yaba')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(setup().service.detail('me', HERE)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses a record that is active again', async () => {
    const t = setup();
    t.memberService.getById.mockImplementation(async (id: string) =>
      id === 'me' ? { id, discuvaAccountId: 'acc' } : { id, status: 'ACTIVE' },
    );
    await expect(t.service.detail('me', 'lekki')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('emails a statement from the old branch for their old record', async () => {
    const t = setup();
    await t.service.emailStatement('me', 'lekki', '2025-01', '2025-12');
    expect(t.tithes.emailGivingStatement).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'old-lekki' }),
      '2025-01',
      '2025-12',
    );
  });
});
