import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChildRoomService } from './child-room.service';

const qb = (raw: unknown[] = []) => {
  const c: any = {};
  for (const m of [
    'innerJoin',
    'select',
    'addSelect',
    'where',
    'andWhere',
    'groupBy',
    'addGroupBy',
  ])
    c[m] = jest.fn(() => c);
  c.getRawMany = jest.fn().mockResolvedValue(raw);
  return c;
};

function setup(opts: { last?: unknown; lead?: boolean } = {}) {
  const dutyRepo: any = {
    findOne: jest.fn().mockResolvedValue(opts.last ?? null),
    createQueryBuilder: jest.fn(() =>
      qb([
        { classGroupId: 'pre', firstname: 'Funmi' },
        { classGroupId: null, firstname: 'Kemi' },
      ]),
    ),
    query: jest.fn().mockResolvedValue([]),
  };
  const classGroupRepo: any = {
    find: jest.fn().mockResolvedValue([
      {
        id: 'pre',
        name: 'Preschool',
        capacity: 25,
        childrenPerTeacher: 6,
        ageGroup: { id: 'g2', minAgeMonths: 36, maxAgeMonths: 71 },
      },
      {
        id: 'cr',
        name: 'Crèche room',
        capacity: 10,
        childrenPerTeacher: 3,
        ageGroup: { id: 'g1', minAgeMonths: 0, maxAgeMonths: 17 },
      },
    ]),
    findOne: jest.fn(),
  };
  const ageGroupRepo: any = {
    find: jest.fn().mockResolvedValue([
      {
        id: 'g1',
        name: 'Crèche',
        minAgeMonths: 0,
        maxAgeMonths: 17,
        displayOrder: 0,
      },
      {
        id: 'g2',
        name: 'Preschool',
        minAgeMonths: 36,
        maxAgeMonths: 71,
        displayOrder: 1,
      },
    ]),
  };
  const childRepo: any = {
    createQueryBuilder: jest.fn(() =>
      qb([
        { ageGroupId: 'g2', classGroupId: 'pre', n: 2 },
        { ageGroupId: null, classGroupId: null, n: 1 },
      ]),
    ),
    find: jest.fn().mockResolvedValue([
      { id: 'a', dateOfBirth: '2022-01-01', ageGroup: { id: 'g2' } },
      { id: 'b', dateOfBirth: '2018-01-01', ageGroup: { id: 'g2' } },
      { id: 'c', dateOfBirth: '2026-06-01', ageGroup: null },
    ]),
  };
  const cache: any = { key: jest.fn(() => 'k'), del: jest.fn() };
  const team: any = { requireTeam: jest.fn().mockResolvedValue(undefined) };
  const dashboard: any = {
    isLead: jest.fn().mockResolvedValue(opts.lead ?? true),
  };
  const children: any = {
    createAgeGroup: jest.fn().mockResolvedValue({ id: 'g3' }),
    deleteClassGroup: jest.fn().mockResolvedValue(undefined),
    batchRecomputeAgeGroups: jest.fn().mockResolvedValue({ updated: 2 }),
  };
  const service = new ChildRoomService(
    dutyRepo,
    classGroupRepo,
    ageGroupRepo,
    childRepo,
    { get: jest.fn().mockResolvedValue('Africa/Lagos') } as any,
    cache,
    team,
    dashboard,
    children,
  );
  return { service, dutyRepo, classGroupRepo, cache, children, team };
}

describe('ChildRoomService', () => {
  it('asks the first time: no room yet, with every room and who is in it', async () => {
    const { service, dutyRepo } = setup();
    const r = await service.myDuty({ id: 'me' } as any);
    expect(r.duty).toBeNull();
    expect(r.rooms[0]).toMatchObject({
      id: 'pre',
      here: ['Funmi'],
      minAgeMonths: 36,
    });
    expect(r.atFrontDesk).toEqual(['Kemi']);
    expect(dutyRepo.query).not.toHaveBeenCalled();
  });

  it("carries last week's room over to today without asking", async () => {
    const { service, dutyRepo, cache } = setup({
      last: {
        id: 'd1',
        day: '2020-01-05',
        classGroup: { id: 'pre', name: 'Preschool' },
      },
    });
    const r = await service.myDuty({ id: 'me' } as any);
    expect(r.duty).toEqual({
      classGroupId: 'pre',
      roomName: 'Preschool',
      frontDesk: false,
      remembered: true,
    });
    expect(dutyRepo.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (member_id, day)'),
      ['me', 'pre', expect.any(String)],
    );
    expect(cache.del).toHaveBeenCalled();
  });

  it('a front desk pick carries over as the front desk', async () => {
    const { service } = setup({
      last: { id: 'd1', day: '2020-01-05', classGroup: null },
    });
    expect((await service.myDuty({ id: 'me' } as any)).duty).toMatchObject({
      frontDesk: true,
      roomName: null,
    });
  });

  it('only the team can pick a room, and only a real one', async () => {
    const { service, classGroupRepo, team } = setup();
    classGroupRepo.findOne.mockResolvedValue(null);
    await expect(service.setDuty({ id: 'me' } as any, 'nope')).rejects.toThrow(
      NotFoundException,
    );
    expect(team.requireTeam).toHaveBeenCalled();
    expect(await service.setDuty({ id: 'me' } as any, null)).toMatchObject({
      frontDesk: true,
    });
  });

  it('setup lists groups with their rooms and counts, and how many children now fit another group', async () => {
    const { service } = setup();
    const r = await service.setup({ id: 'hod' } as any);
    expect(
      r.groups.map((g) => [g.name, g.children, g.rooms.map((x) => x.name)]),
    ).toEqual([
      ['Crèche', 0, ['Crèche room']],
      ['Preschool', 2, ['Preschool']],
    ]);
    expect(r.groups[1].rooms[0]).toMatchObject({
      children: 2,
      childrenPerTeacher: 6,
    });
    // b is too old for Preschool; c is a baby with no group yet.
    expect(r.toMove).toBe(2);
  });

  it('setup is for the HOD and deputy only', async () => {
    const { service, children } = setup({ lead: false });
    await expect(service.setup({ id: 'm' } as any)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(
      service.addGroup({ id: 'm' } as any, {
        name: 'X',
        minAgeMonths: 0,
        maxAgeMonths: 5,
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(children.createAgeGroup).not.toHaveBeenCalled();
  });

  it('regroup and room changes go through the existing rules', async () => {
    const { service, children } = setup();
    expect(await service.regroup({ id: 'hod' } as any)).toEqual({ updated: 2 });
    await service.deleteRoom({ id: 'hod' } as any, 'pre');
    expect(children.deleteClassGroup).toHaveBeenCalledWith('pre');
  });
});
