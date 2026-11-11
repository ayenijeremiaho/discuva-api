import { NotFoundException } from '@nestjs/common';
import { NetworkEventsService } from './network-events.service';

// root → lagos → ikeja; here = ikeja unless changed.
const byId = new Map([
  ['root', { id: 'root', isActive: true }],
  ['lagos', { id: 'lagos', isActive: true }],
  ['ikeja', { id: 'ikeja', isActive: true }],
]);
const ev = (tenantId: string, eventId: string, over: object = {}) => ({
  tenantId,
  eventId,
  networkRootId: 'root',
  name: eventId,
  description: null,
  startTime: new Date('2026-12-01T09:00:00Z'),
  endTime: new Date('2026-12-01T11:00:00Z'),
  audience: 'EVERYONE',
  venueName: null,
  serviceCount: 1,
  shared: true,
  ...over,
});

function setup(here = 'ikeja', available = true) {
  const tenantRepo = {
    findOne: jest.fn().mockResolvedValue({ id: here, networkRootId: 'root' }),
    exists: jest.fn().mockResolvedValue(true),
  };
  const eventRepo = {
    find: jest
      .fn()
      .mockResolvedValue([ev('root', 'convention'), ev('lagos', 'retreat')]),
    exists: jest.fn().mockResolvedValue(true),
  };
  const hideRepo = {
    find: jest
      .fn()
      .mockResolvedValue([
        { tenantId: 'ikeja', sourceTenantId: 'lagos', eventId: 'retreat' },
      ]),
    upsert: jest.fn(),
    delete: jest.fn(),
  };
  const announcementRepo = { find: jest.fn().mockResolvedValue([]) };
  const network = {
    isAvailable: jest.fn().mockResolvedValue(available),
    loadTree: jest.fn().mockResolvedValue({ rootId: 'root', byId }),
    ancestorIds: jest.fn(
      (_t: unknown, id: string) =>
        ({ ikeja: ['lagos', 'root'], lagos: ['root'], root: [] })[id],
    ),
    subtreeIds: jest.fn(
      (_t: unknown, id: string) =>
        ({
          root: ['root', 'lagos', 'ikeja'],
          lagos: ['lagos', 'ikeja'],
          ikeja: ['ikeja'],
        })[id],
    ),
    pathsOf: jest.fn().mockResolvedValue(
      new Map([
        ['root', 'ABC'],
        ['lagos', 'ABC · Lagos'],
        ['ikeja', 'ABC · Lagos · Ikeja'],
      ]),
    ),
  };
  const cls = { get: jest.fn().mockReturnValue(here) };
  const service = new NetworkEventsService(
    tenantRepo as never,
    eventRepo as never,
    hideRepo as never,
    announcementRepo as never,
    network as never,
    cls as never,
  );
  return { service, eventRepo, hideRepo };
}

const from = new Date('2026-11-29T00:00:00Z');
const to = new Date('2026-12-06T00:00:00Z');

describe('NetworkEventsService', () => {
  it('shows members the events shared by churches above them, minus the ones their branch hid', async () => {
    const t = setup();
    const list = await t.service.forMember(false, from, to);
    expect(list.map((e) => e.eventId)).toEqual(['convention']);
    expect(list[0].fromPath).toBe('ABC');
    const where = t.eventRepo.find.mock.calls[0][0].where;
    expect(where.tenantId._value).toEqual(['lagos', 'root']);
    expect(where.shared).toBe(true);
    expect(where.audience._value).toEqual(['EVERYONE']);
  });

  it('includes workers-only events for workers', async () => {
    const t = setup();
    await t.service.forMember(true, from, to);
    expect(t.eventRepo.find.mock.calls[0][0].where.audience._value).toEqual([
      'EVERYONE',
      'WORKERS',
    ]);
  });

  it('is empty with the switch off', async () => {
    expect(
      await setup('ikeja', false).service.forMember(false, from, to),
    ).toEqual([]);
  });

  it('lets a branch hide only what churches above it shared', async () => {
    const t = setup();
    await t.service.setHidden('lagos', 'retreat', true);
    expect(t.hideRepo.upsert).toHaveBeenCalledWith(
      { tenantId: 'ikeja', sourceTenantId: 'lagos', eventId: 'retreat' },
      expect.anything(),
    );
    const fromBelow = setup('lagos');
    await expect(
      fromBelow.service.setHidden('ikeja', 'x', true),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('gives a region the agenda of everything under it, never above', async () => {
    const t = setup('lagos');
    const view = await t.service.agenda(from, to);
    expect(view.churches.map((c) => c.id)).toEqual(['lagos', 'ikeja']);
    expect(t.eventRepo.find.mock.calls[0][0].where.tenantId._value).toEqual([
      'lagos',
      'ikeja',
    ]);
    await expect(t.service.agenda(from, to, 'root')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses ranges over two months', async () => {
    await expect(
      setup('root').service.agenda(from, new Date('2027-03-01T00:00:00Z')),
    ).rejects.toThrow(/62 days/);
  });
});
