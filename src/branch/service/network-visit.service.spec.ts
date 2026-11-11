import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NetworkVisitService } from './network-visit.service';

jest.mock('../../tenant/utility/run-in-tenant-context', () => ({
  runInTenantContext: (
    _c: unknown,
    _t: unknown,
    _e: unknown,
    fn: () => unknown,
  ) => fn(),
}));

const HOME = 'ikeja';
const HOST = 'lekki';
const LEKKI = { latitude: 6.4474, longitude: 3.4723 };

function setup(
  over: {
    account?: string | null;
    available?: boolean;
    threshold?: number;
    visits?: number;
  } = {},
) {
  const churches: Record<string, object> = {
    [HOME]: { id: HOME, schemaName: 's_ikeja', networkRootId: 'root' },
    [HOST]: { id: HOST, schemaName: 's_lekki', networkRootId: 'root' },
    other: { id: 'other', schemaName: 's_other', networkRootId: 'elsewhere' },
  };
  const tenantRepo = {
    findOne: jest.fn(async ({ where }) => churches[where.id] ?? null),
  };
  const codeRepo = {
    findOne: jest.fn(async ({ where }) =>
      where.code === 'ABC234'
        ? { tenantId: HOST }
        : where.tenantId === HOST
          ? { code: 'ABC234' }
          : null,
    ),
  };
  const visitorRepo = {
    count: jest.fn().mockResolvedValue(over.visits ?? 1),
    find: jest.fn(),
  };
  const network = {
    isAvailable: jest.fn().mockResolvedValue(over.available ?? true),
    pathsOf: jest.fn().mockResolvedValue(
      new Map([
        [HOST, 'ABC · Lekki'],
        [HOME, 'ABC · Ikeja'],
      ]),
    ),
  };
  const networkVenues = {
    forNetwork: jest.fn().mockResolvedValue([
      {
        tenantId: HOME,
        venueId: 'v-home',
        name: 'Ikeja Hall',
        latitude: 6.6018,
        longitude: 3.3515,
      },
      { tenantId: HOST, venueId: 'v-host', name: 'Lekki Hall', ...LEKKI },
    ]),
  };
  const member = {
    id: 'm1',
    firstname: 'Bola',
    lastname: 'Ade',
    email: 'b@x.test',
    status: 'ACTIVE',
    photoUrl: null,
    discuvaAccountId: over.account === undefined ? 'acc' : over.account,
  };
  const memberService = { getById: jest.fn().mockResolvedValue(member) };
  const slot = {
    id: 's1',
    name: 'First Service',
    startTime: new Date(),
    endTime: new Date(),
    event: { id: 'e1' },
  };
  const attendance = {
    openVisitorSlots: jest.fn().mockResolvedValue([slot]),
    assertVisitorCanCheckIn: jest.fn().mockResolvedValue(slot),
    recordAttendedElsewhere: jest.fn().mockResolvedValue(1),
  };
  const settings = {
    getNumber: jest.fn(async (k: string) =>
      k.endsWith('visits') ? (over.threshold ?? 4) : 8,
    ),
  };
  const timezone = { get: jest.fn().mockResolvedValue('Africa/Lagos') };
  const insertQb: any = {
    insert: () => insertQb,
    values: () => insertQb,
    orIgnore: () => insertQb,
    execute: jest.fn().mockResolvedValue({ raw: [{ id: 'v1' }] }),
  };
  (visitorRepo as any).createQueryBuilder = () => insertQb;
  const cls = { get: jest.fn().mockReturnValue(HOME) };
  const service = new NetworkVisitService(
    tenantRepo as never,
    codeRepo as never,
    visitorRepo as never,
    network as never,
    networkVenues as never,
    memberService as never,
    attendance as never,
    settings as never,
    timezone as never,
    { log: jest.fn() } as never,
    cls as never,
    {} as never,
  );
  return { service, attendance, insertQb };
}

describe('NetworkVisitService', () => {
  it("offers the nearest other branch's open services, never your own", async () => {
    const t = setup();
    const place = await t.service.nearby('m1', { ...LEKKI, accuracy: 20 });
    expect(place).toEqual(
      expect.objectContaining({
        tenantId: HOST,
        path: 'ABC · Lekki',
        venueName: 'Lekki Hall',
      }),
    );
    expect(t.attendance.openVisitorSlots).toHaveBeenCalledWith('v-host');
    expect(
      await t.service.nearby('m1', { latitude: 6.6018, longitude: 3.3515 }),
    ).toBeNull();
    expect(
      await t.service.nearby('m1', { latitude: 9.07, longitude: 7.49 }),
    ).toBeNull();
  });

  it('checks in by location: the host records the visitor, home records attended elsewhere', async () => {
    const t = setup({ visits: 1 });
    const result = await t.service.checkIn('m1', {
      tenantId: HOST,
      serviceSlotId: 's1',
      location: LEKKI,
    });
    expect(t.attendance.assertVisitorCanCheckIn).toHaveBeenCalledWith(
      's1',
      LEKKI,
    );
    expect(t.insertQb.execute).toHaveBeenCalled();
    expect(t.attendance.recordAttendedElsewhere).toHaveBeenCalledWith(
      'm1',
      HOST,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
    expect(result).toEqual(
      expect.objectContaining({ path: 'ABC · Lekki', suggestMove: false }),
    );
  });

  it('a venue code stands in for location, but only for its own branch', async () => {
    const t = setup();
    await t.service.checkIn('m1', {
      tenantId: HOST,
      serviceSlotId: 's1',
      code: 'abc234',
    });
    expect(t.attendance.assertVisitorCanCheckIn).toHaveBeenCalledWith(
      's1',
      null,
    );
    await expect(t.service.byCode('m1', 'ZZZZZZ')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('needs location or a code', async () => {
    await expect(
      setup().service.checkIn('m1', { tenantId: HOST, serviceSlotId: 's1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('suggests moving home once the visits reach the setting, and never at 0', async () => {
    const at = await setup({ threshold: 4, visits: 4 }).service.checkIn('m1', {
      tenantId: HOST,
      serviceSlotId: 's1',
      location: LEKKI,
    });
    expect(at.suggestMove).toBe(true);
    const off = await setup({ threshold: 0, visits: 9 }).service.checkIn('m1', {
      tenantId: HOST,
      serviceSlotId: 's1',
      location: LEKKI,
    });
    expect(off.suggestMove).toBe(false);
  });

  it('refuses your own branch, branches outside the network, no account, and the switch off', async () => {
    const t = setup();
    await expect(
      t.service.checkIn('m1', {
        tenantId: HOME,
        serviceSlotId: 's1',
        location: LEKKI,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      t.service.checkIn('m1', {
        tenantId: 'other',
        serviceSlotId: 's1',
        location: LEKKI,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      setup({ account: null }).service.nearby('m1', LEKKI),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      setup({ available: false }).service.nearby('m1', LEKKI),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('says already checked in when the host already has them for that service day', async () => {
    const t = setup();
    t.insertQb.execute.mockResolvedValue({ raw: [] });
    await expect(
      t.service.checkIn('m1', {
        tenantId: HOST,
        serviceSlotId: 's1',
        location: LEKKI,
      }),
    ).rejects.toMatchObject({
      response: { code: 'ALREADY_CHECKED_IN' },
    });
    expect(t.attendance.recordAttendedElsewhere).not.toHaveBeenCalled();
  });
});
