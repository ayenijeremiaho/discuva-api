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
  lateNotifiedAt: null,
  flagReason: null,
  childFirstname: 'Tobi',
  childLastname: 'Ade',
  classGroupId: 'pre',
  classGroupName: 'Preschool',
  ...o,
});

function setup(opts: { lead: boolean; rows?: unknown[]; sundays?: unknown[] }) {
  const today = chain({ raw: opts.rows ?? [] });
  const sundays = chain({ raw: opts.sundays ?? [] });
  const checkInRepo: any = {
    createQueryBuilder: jest
      .fn()
      .mockReturnValueOnce(today)
      .mockReturnValueOnce(sundays),
    query: jest.fn().mockResolvedValue([{ n: 9 }]),
  };
  const classGroupRepo: any = {
    find: jest.fn().mockResolvedValue([
      { id: 'pre', name: 'Preschool', childrenPerTeacher: 6 },
      { id: 'jun', name: 'Juniors', childrenPerTeacher: null },
      { id: 'teen', name: 'Teens', childrenPerTeacher: 10 },
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
  };
  const leadRepo: any = {
    createQueryBuilder: jest.fn(() => chain({ exists: opts.lead })),
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
    { get: jest.fn().mockResolvedValue('Africa/Lagos') } as any,
    cache,
  );
  return { service, cache };
}

describe('ChildrenChurchDashboardService', () => {
  it("is only for the HOD and deputy of the department that runs Children's Church", async () => {
    const { service } = setup({ lead: false });
    await expect(service.today({ id: 'm1' } as any)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('counts rooms, teachers and what needs attention, then caches it briefly', async () => {
    const preschool = Array.from({ length: 13 }, (_, i) =>
      row({ id: `p${i}`, checkedInById: i % 2 ? 't1' : 't2' }),
    );
    const { service, cache } = setup({
      lead: true,
      rows: [
        ...preschool,
        row({ id: 'late', lateNotifiedAt: new Date(), checkedInById: 't2' }),
        row({
          id: 'out',
          status: ChildCheckInStatusEnum.CHECKED_OUT,
          classGroupId: 'jun',
          classGroupName: 'Juniors',
          checkedInById: 't3',
        }),
        row({
          id: 'flag',
          status: ChildCheckInStatusEnum.FLAGGED,
          flagReason: 'Code mismatch',
          classGroupId: 'jun',
          classGroupName: 'Juniors',
          checkedInById: 't3',
        }),
      ],
      sundays: [
        { d: '2026-11-01', n: 80 },
        { d: '2026-11-08', n: 84 },
        { d: '2026-11-11', n: 12 },
      ],
    });
    const d = await service.today({ id: 'hod' } as any);

    expect(d.childrenInNow).toBe(14);
    expect(d.teachersOnDuty).toBe(3);
    expect(d.collected).toBe(1);
    const pre = d.rooms.find((r) => r.id === 'pre')!;
    expect(pre).toMatchObject({
      children: 14,
      teachers: 2,
      needsTeacher: true,
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
    expect(d.month).toEqual({
      averageSunday: 82,
      newChildren: 6,
      missedThreeWeeks: 9,
    });
    expect(cache.set).toHaveBeenCalledWith('k', d, 60);
  });
});
