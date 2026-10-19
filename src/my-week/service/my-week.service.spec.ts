import { MyWeekService } from './my-week.service';
import { MeetingFrequencyEnum } from '../../small-group/enum/meeting-frequency.enum';

describe('MyWeekService', () => {
  // Monday 19 Oct 2026, 09:00 in Lagos.
  const now = new Date('2026-10-19T08:00:00Z');
  const qb = (result: () => unknown) => {
    const q: Record<string, jest.Mock> = {};
    for (const m of [
      'innerJoinAndSelect',
      'leftJoin',
      'addSelect',
      'where',
      'andWhere',
      'orWhere',
      'setParameter',
    ])
      q[m] = jest.fn().mockReturnValue(q);
    q.getMany = jest.fn(() => Promise.resolve(result()));
    q.getRawAndEntities = jest.fn(() => Promise.resolve(result()));
    return q;
  };
  let roster: unknown[] = [];
  let groups: unknown[] = [];
  let sessions: { entities: unknown[]; raw: unknown[] } = {
    entities: [],
    raw: [],
  };
  const rosterRepo = { createQueryBuilder: jest.fn(() => qb(() => roster)) };
  const groupRepo = { createQueryBuilder: jest.fn(() => qb(() => groups)) };
  const sessionRepo = {
    createQueryBuilder: jest.fn(() => qb(() => sessions)),
  };
  const churchSettings = { isEnabled: jest.fn() };
  const spaces = { memberships: jest.fn().mockResolvedValue([]) };
  const planFeatures = { gateReason: jest.fn() };
  const service = new MyWeekService(
    rosterRepo as never,
    groupRepo as never,
    sessionRepo as never,
    churchSettings as never,
    planFeatures as never,
    { get: jest.fn().mockResolvedValue('Africa/Lagos') } as never,
    { get: jest.fn().mockReturnValue('tenant-1') } as never,
    spaces as never,
  );

  const prayerRow = (date: string, start: string, end: string) => ({
    id: `r-${date}`,
    meeting: {
      date,
      dayConfig: { startTime: start, endTime: end, mode: 'VIRTUAL' },
      program: { name: 'Morning Prayer' },
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    churchSettings.isEnabled.mockResolvedValue(true);
    planFeatures.gateReason.mockResolvedValue(null);
    roster = [];
    groups = [];
    sessions = { entities: [], raw: [] };
  });

  it('lists prayer slots in church time, leaving out ones already over', async () => {
    roster = [
      prayerRow('2026-10-19', '05:00', '06:00'),
      prayerRow('2026-10-21', '05:00', '06:00'),
    ];
    const items = await service.forMember('m1', 'wp1', now);
    expect(items).toEqual([
      expect.objectContaining({
        kind: 'prayer',
        title: 'Morning Prayer',
        detail: 'Online',
        startsAt: '2026-10-21T04:00:00.000Z',
        endsAt: '2026-10-21T05:00:00.000Z',
        url: '/prayer',
      }),
    ]);
  });

  it('shows the next fellowship meeting and marks the leader', async () => {
    groups = [
      {
        id: 'g1',
        name: 'Ikeja Fellowship',
        leader: { id: 'm1' },
        meetingFrequency: MeetingFrequencyEnum.WEEKLY,
        meetingWeekday: 3,
        meetingStartTime: '18:00',
        meetingEndTime: '19:30',
        meetingIntervalWeeks: 1,
        meetingLocation: 'Ada’s house',
      },
    ];
    const [item] = await service.forMember('m1', undefined, now);
    expect(item).toEqual(
      expect.objectContaining({
        kind: 'fellowship',
        role: 'Leader',
        startsAt: '2026-10-21T17:00:00.000Z',
        endsAt: '2026-10-21T18:30:00.000Z',
        detail: 'Ada’s house',
        url: '/small-groups/g1',
      }),
    );
  });

  it('marks class sessions the member facilitates', async () => {
    sessions = {
      entities: [
        {
          id: 's1',
          title: 'Week 3: Prayer',
          startsAt: new Date('2026-10-20T16:00:00Z'),
          endsAt: null,
          location: null,
          churchClass: { id: 'c1', name: 'Foundation Class' },
        },
      ],
      raw: [{ is_facilitator: true }],
    };
    const [item] = await service.forMember('m1', undefined, now);
    expect(item).toEqual(
      expect.objectContaining({
        kind: 'class',
        title: 'Foundation Class',
        detail: 'Week 3: Prayer',
        role: 'Facilitator',
        url: '/classes/c1',
      }),
    );
  });

  it('puts everything in date order', async () => {
    roster = [prayerRow('2026-10-22', '05:00', '06:00')];
    sessions = {
      entities: [
        {
          id: 's1',
          title: null,
          startsAt: new Date('2026-10-20T16:00:00Z'),
          endsAt: null,
          location: 'Room 2',
          churchClass: { id: 'c1', name: 'Foundation Class' },
        },
      ],
      raw: [{ is_facilitator: false }],
    };
    const kinds = (await service.forMember('m1', 'wp1', now)).map(
      (i) => i.kind,
    );
    expect(kinds).toEqual(['class', 'prayer']);
  });

  it('skips modules the church has off or that are not on its plan', async () => {
    churchSettings.isEnabled.mockImplementation((key: string) =>
      Promise.resolve(key !== 'prayer'),
    );
    planFeatures.gateReason.mockImplementation((_: string, key: string) =>
      Promise.resolve(key === 'classes' ? 'NOT_ON_PLAN' : null),
    );
    await service.forMember('m1', 'wp1', now);
    expect(rosterRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(sessionRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(groupRepo.createQueryBuilder).toHaveBeenCalled();
  });
});
