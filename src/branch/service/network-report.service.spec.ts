import { NetworkReportService } from './network-report.service';
import {
  openPeriods,
  periodOf,
  previousPeriod,
} from './network-rollup.service';

const metrics = (over: object = {}) => ({
  members: 100,
  newMembers: 6,
  firstTimers: 10,
  returnedTwice: 3,
  returnedThrice: 1,
  stoppedFourWeeks: 7,
  stoppedEightWeeks: 2,
  transfersIn: 0,
  transfersOut: 5,
  visitorsIn: 8,
  visitsOut: 4,
  services: 4,
  attendance: 320,
  online: 80,
  ratingCount: 10,
  ratingAverage: 4.5,
  milestones: 5,
  classCompletions: 9,
  contactedInWeek: 6,
  giving: null,
  ...over,
});

function setup(rows: object[]) {
  const byId = new Map([
    ['root', { isActive: true }],
    ['lagos', { isActive: true }],
    ['ikeja', { isActive: true }],
  ]);
  const network = {
    isAvailable: jest.fn().mockResolvedValue(true),
    loadTree: jest.fn().mockResolvedValue({ byId }),
    subtreeIds: jest.fn((_t: unknown, id: string) =>
      id === 'root' ? ['root', 'lagos', 'ikeja'] : [id],
    ),
    pathsOf: jest.fn().mockResolvedValue(
      new Map([
        ['root', 'ABC'],
        ['lagos', 'ABC · Lagos'],
        ['ikeja', 'ABC · Ikeja'],
      ]),
    ),
  };
  const rollupRepo = { find: jest.fn().mockResolvedValue(rows) };
  const cache = {
    getGlobal: jest.fn().mockResolvedValue(undefined),
    setGlobal: jest.fn(),
  };
  const tenantRepo = {
    findOne: jest.fn().mockResolvedValue({
      id: 'root',
      networkRootId: 'root',
      timezone: 'UTC',
    }),
  };
  const service = new NetworkReportService(
    tenantRepo as never,
    rollupRepo as never,
    network as never,
    cache as never,
    { get: () => 'root' } as never,
  );
  return { service, rollupRepo, cache };
}

describe('report months', () => {
  it('keeps last month open until the 7th, in the church’s own time zone', () => {
    expect(openPeriods(new Date('2026-12-07T12:00:00Z'), 'UTC')).toEqual([
      '2026-12',
      '2026-11',
    ]);
    expect(openPeriods(new Date('2026-12-08T12:00:00Z'), 'UTC')).toEqual([
      '2026-12',
    ]);
    expect(periodOf(new Date('2026-11-30T23:30:00Z'), 'Africa/Lagos')).toBe(
      '2026-12',
    );
    expect(previousPeriod('2027-01')).toBe('2026-12');
  });
});

describe('NetworkReportService', () => {
  const rows = [
    {
      tenantId: 'root',
      computedAt: new Date('2026-11-11T10:00:00Z'),
      metrics: metrics(),
      attention: [],
    },
    {
      tenantId: 'ikeja',
      computedAt: new Date('2026-11-11T10:42:00Z'),
      metrics: metrics({
        members: 50,
        firstTimers: 3,
        services: 0,
        giving: 120000,
        ratingCount: 0,
        ratingAverage: null,
      }),
      attention: [
        {
          kind: 'FEW_ADMINS',
          detail: 'Only one admin looks after this branch.',
        },
      ],
    },
  ];

  it('shows counts of 1–4 people as fewer than 5, never the number', async () => {
    const report = await setup(rows).service.reportFor(
      'root',
      'root',
      'UTC',
      '2026-11',
    );
    const ikeja = report.churches.find((c) => c.id === 'ikeja')!;
    expect(ikeja.figures.firstTimers).toBe('FEWER_THAN_5');
    expect(ikeja.figures.returnedTwice).toBe('FEWER_THAN_5');
    expect(ikeja.figures.members).toBe(50);
    expect(ikeja.perHundred.firstTimers).toBeNull();
    expect(
      report.churches.find((c) => c.id === 'root')!.perHundred.firstTimers,
    ).toBe(10);
  });

  it('adds up totals, weights the rating average, and only totals giving that was shared', async () => {
    const report = await setup(rows).service.reportFor(
      'root',
      'root',
      'UTC',
      '2026-11',
    );
    expect(report.totals.members).toBe(150);
    expect(report.totals.firstTimers).toBe(13);
    expect(report.totals.ratingAverage).toBe(4.5);
    expect(report.totals.giving).toBe(120000);
    expect(report.median.members).toBe(75);
    expect(report.median.stoppedEightWeeks).toBe('FEWER_THAN_5');
    expect(report.updatedAt).toEqual(new Date('2026-11-11T10:42:00Z'));
  });

  it('lists churches with no figures yet, and covers only the church and those under it', async () => {
    const t = setup(rows);
    const report = await t.service.reportFor('root', 'root', 'UTC', '2026-11');
    expect(report.churches.map((c) => c.id)).toEqual([
      'root',
      'lagos',
      'ikeja',
    ]);
    expect(
      report.churches.find((c) => c.id === 'lagos')!.figures.members ?? null,
    ).toBeNull();
    expect(t.rollupRepo.find.mock.calls[0][0].where.tenantId._value).toEqual([
      'root',
      'lagos',
      'ikeja',
    ]);
  });

  it('carries the attention list only for the current month', async () => {
    const t = setup(rows);
    const now = periodOf(new Date(), 'UTC');
    expect(
      (await t.service.reportFor('root', 'root', 'UTC', now)).attention,
    ).toEqual([
      expect.objectContaining({
        churchId: 'ikeja',
        path: 'ABC · Ikeja',
        kind: 'FEW_ADMINS',
      }),
    ]);
    expect(
      (await t.service.reportFor('root', 'root', 'UTC', '2025-01')).attention,
    ).toEqual([]);
    expect(
      (await t.service.reportFor('root', 'root', 'UTC', '2025-01')).final,
    ).toBe(true);
  });

  it('serves a repeat from cache until any branch is recalculated', async () => {
    const t = setup(rows);
    t.cache.getGlobal.mockImplementation(async (key: string) =>
      key.startsWith('network-rollup-ver') ? 7 : undefined,
    );
    await t.service.reportFor('root', 'root', 'UTC', '2026-11');
    expect(t.cache.setGlobal).toHaveBeenCalledWith(
      'network-report:root:2026-11:7',
      expect.anything(),
      3600,
    );
  });
});
