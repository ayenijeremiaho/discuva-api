import { ForbiddenException } from '@nestjs/common';
import { ChildrenChurchDashboardService } from './children-church-dashboard.service';
import { ChildCheckInStatusEnum } from '../enums/child-checkin-status.enum';

const chain = (r: {
  raw?: unknown[];
  many?: unknown[];
  count?: number;
  exists?: boolean;
}) => {
  const c: any = {};
  for (const m of [
    'innerJoin',
    'leftJoin',
    'select',
    'addSelect',
    'where',
    'andWhere',
    'orderBy',
    'limit',
    'groupBy',
    'addGroupBy',
    'setParameter',
  ]) {
    c[m] = jest.fn(() => c);
  }
  c.getRawMany = jest.fn().mockResolvedValue(r.raw ?? []);
  c.getMany = jest.fn().mockResolvedValue(r.many ?? []);
  c.getCount = jest.fn().mockResolvedValue(r.count ?? 0);
  c.getExists = jest.fn().mockResolvedValue(r.exists ?? false);
  return c;
};

const row = (o: Partial<Record<string, unknown>>) => ({
  id: 'ci',
  status: ChildCheckInStatusEnum.CHECKED_IN,
  checkedInById: 't1',
  teacherFirstname: 'Funmi',
  teacherLastname: 'Lawal',
  lateNotifiedAt: null,
  flagReason: null,
  childFirstname: 'Tobi',
  childLastname: 'Ade',
  classGroupId: 'pre',
  classGroupName: 'Preschool',
  ...o,
});

function setup(opts: {
  lead: boolean;
  rows?: unknown[];
  days?: unknown[];
  dayTeachers?: unknown[];
  slots?: unknown[];
}) {
  const checkInRepo: any = {
    createQueryBuilder: jest
      .fn()
      .mockReturnValueOnce(chain({ raw: opts.rows ?? [] }))
      .mockReturnValueOnce(chain({ raw: opts.days ?? [] }))
      .mockReturnValueOnce(chain({ raw: opts.dayTeachers ?? [] })),
    query: jest.fn().mockResolvedValue([{ n: 9 }]),
  };
  const classGroupRepo: any = {
    find: jest.fn().mockResolvedValue([
      { id: 'pre', name: 'Preschool', capacity: 25, childrenPerTeacher: 6 },
      { id: 'jun', name: 'Juniors', capacity: 30, childrenPerTeacher: null },
      { id: 'teen', name: 'Teens', capacity: 20, childrenPerTeacher: 10 },
    ]),
  };
  const childRepo: any = {
    createQueryBuilder: jest
      .fn()
      .mockReturnValueOnce(
        chain({
          many: [
            {
              id: 'c1',
              firstname: 'Tobi',
              lastname: 'Ade',
              specialNotes: 'Peanuts\nUses an inhaler',
              notesUpdatedBy: { firstname: 'Grace', lastname: 'Ade' },
            },
          ],
        }),
      )
      .mockReturnValueOnce(chain({ count: 6 })),
    count: jest.fn().mockResolvedValue(3),
    query: jest.fn().mockResolvedValue([{ n: 4 }]),
  };
  const leadRepo: any = {
    createQueryBuilder: jest.fn(() => chain({ exists: opts.lead })),
  };
  const slotRepo: any = {
    createQueryBuilder: jest.fn(() => chain({ many: opts.slots ?? [] })),
  };
  const cache: any = {
    key: jest.fn(() => 'k'),
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn(),
  };
  const service = new ChildrenChurchDashboardService(
    checkInRepo,
    classGroupRepo,
    childRepo,
    leadRepo,
    slotRepo,
    { get: jest.fn().mockResolvedValue('Africa/Lagos') } as any,
    cache,
  );
  return { service, cache };
}

const minutes = (m: number) => new Date(Date.now() + m * 60_000);

describe('ChildrenChurchDashboardService', () => {
  it("is only for the HOD and deputy of the department that runs Children's Church", async () => {
    const { service } = setup({ lead: false });
    await expect(service.today({ id: 'm1' } as any)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('during a service: live slot, rooms with places and teacher initials, what needs attention', async () => {
    const preschool = Array.from({ length: 13 }, (_, i) =>
      row({
        id: `p${i}`,
        checkedInById: i % 2 ? 't1' : 't2',
        teacherFirstname: i % 2 ? 'Funmi' : 'Ola',
        teacherLastname: i % 2 ? 'Lawal' : 'Martins',
      }),
    );
    const { service, cache } = setup({
      lead: true,
      slots: [
        {
          id: 's1',
          name: 'First service',
          startTime: minutes(-60),
          endTime: minutes(72),
        },
        {
          id: 's2',
          name: 'Second service',
          startTime: minutes(150),
          endTime: minutes(270),
        },
      ],
      rows: [
        ...preschool,
        row({
          id: 'late',
          lateNotifiedAt: new Date(),
          checkedInById: 't2',
          teacherFirstname: 'Ola',
          teacherLastname: 'Martins',
        }),
        row({
          id: 'out',
          status: ChildCheckInStatusEnum.CHECKED_OUT,
          classGroupId: 'jun',
          classGroupName: 'Juniors',
          checkedInById: 't3',
          teacherFirstname: 'Ada',
          teacherLastname: 'Bell',
        }),
        row({
          id: 'flag',
          status: ChildCheckInStatusEnum.FLAGGED,
          flagReason: 'Code mismatch',
          classGroupId: 'jun',
          classGroupName: 'Juniors',
          checkedInById: 't3',
          teacherFirstname: 'Ada',
          teacherLastname: 'Bell',
        }),
      ],
    });
    const d = await service.today({ id: 'hod' } as any);

    expect(d.service.live).toMatchObject({ name: 'First service' });
    expect(d.service.next).toMatchObject({ name: 'Second service' });
    expect(d.childrenInNow).toBe(14);
    expect(d.checkedInToday).toBe(16);
    expect(d.teachersOnDuty).toBe(3);
    expect(d.collected).toBe(1);
    expect(d.rooms.find((r) => r.id === 'pre')).toMatchObject({
      children: 14,
      capacity: 25,
      teachers: 2,
      teachersNeeded: 3,
      needsTeacher: true,
      teacherInitials: ['OM', 'FL'],
    });
    expect(d.rooms.find((r) => r.id === 'jun')).toMatchObject({
      children: 0,
      teachers: 1,
      needsTeacher: false,
    });
    expect(d.rooms.find((r) => r.id === 'teen')).toBeUndefined();
    expect(d.latePickups.map((l) => l.checkInId)).toEqual(['late']);
    expect(d.flagged).toEqual([
      expect.objectContaining({ checkInId: 'flag', reason: 'Code mismatch' }),
    ]);
    expect(d.parentUpdates[0]).toMatchObject({
      childName: 'Tobi Ade',
      note: 'Uses an inhaler',
      by: 'Grace Ade',
    });
    expect(d.awayToday).toBe(3);
    expect(d.unlinkedChildren).toBe(4);
    expect(cache.set).toHaveBeenCalledWith('k', d, 60);
  });

  it('on a quiet day: next service, last Sunday, teachers to plan per room and this month', async () => {
    const { service } = setup({
      lead: true,
      slots: [
        {
          id: 's9',
          name: 'First service',
          startTime: minutes(3 * 24 * 60),
          endTime: minutes(3 * 24 * 60 + 150),
        },
      ],
      days: [
        {
          d: '2026-11-01',
          classGroupId: 'pre',
          children: 15,
          lastOut: '2026-11-01T11:00:00Z',
        },
        {
          d: '2026-11-08',
          classGroupId: 'pre',
          children: 17,
          lastOut: '2026-11-08T11:05:00Z',
        },
        {
          d: '2026-11-08',
          classGroupId: 'jun',
          children: 12,
          lastOut: '2026-11-08T11:20:00Z',
        },
        {
          d: '2026-11-08',
          classGroupId: 'teen',
          children: 8,
          lastOut: '2026-11-08T11:10:00Z',
        },
      ],
      dayTeachers: [
        { d: '2026-11-01', teachers: 3 },
        { d: '2026-11-08', teachers: 6 },
      ],
    });
    const d = await service.today({ id: 'hod' } as any);

    expect(d.service.live).toBeNull();
    expect(d.service.next).toMatchObject({ name: 'First service' });
    expect(d.childrenInNow).toBe(0);
    expect(d.lastDay).toEqual({
      date: '2026-11-08',
      children: 37,
      teachers: 6,
      lastOut: new Date('2026-11-08T11:20:00Z'),
    });
    expect(
      d.plan.map((p) => [p.id, p.usualChildren, p.teachersNeeded]),
    ).toEqual([
      ['pre', 17, 3],
      ['jun', 12, null],
      ['teen', 8, 1],
    ]);
    expect(d.teachersToPlan).toBe(4);
    expect(d.month.sundays).toEqual(
      [
        { date: '2026-11-01', children: 15 },
        { date: '2026-11-08', children: 37 },
      ].filter((s) => s.date.startsWith(d.date.slice(0, 7))),
    );
    expect(d.month.newChildren).toBe(6);
    expect(d.month.missedThreeWeeks).toBe(9);
  });
});
