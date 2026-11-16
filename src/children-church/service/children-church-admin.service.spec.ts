import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ChildrenChurchAdminService } from './children-church-admin.service';

const chain = (r: {
  many?: unknown[];
  count?: number;
  raw?: unknown[];
  one?: unknown;
}) => {
  const c: any = {};
  for (const m of [
    'leftJoin',
    'leftJoinAndSelect',
    'select',
    'addSelect',
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'skip',
    'take',
    'groupBy',
  ]) {
    c[m] = jest.fn(() => c);
  }
  c.getManyAndCount = jest.fn().mockResolvedValue([r.many ?? [], r.count ?? 0]);
  c.getMany = jest.fn().mockResolvedValue(r.many ?? []);
  c.getOne = jest.fn().mockResolvedValue(r.one ?? null);
  c.getRawMany = jest.fn().mockResolvedValue(r.raw ?? []);
  return c;
};

function setup() {
  const list = chain({
    many: [
      {
        id: 'c1',
        firstname: 'Tobi',
        lastname: 'Ade',
        classGroup: { id: 'g', name: 'Preschool' },
        registeredBy: { firstname: 'Funmi', lastname: 'Lawal' },
      },
      {
        id: 'c2',
        firstname: 'David',
        lastname: 'Bello',
        classGroup: null,
        registeredBy: null,
      },
    ],
    count: 2,
  });
  const childRepo: any = {
    createQueryBuilder: jest.fn(() => list),
    findOne: jest.fn(),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    query: jest.fn().mockResolvedValue([{ total: 48, linked: 42 }]),
  };
  const guardianRepo: any = {
    createQueryBuilder: jest.fn(() =>
      chain({
        raw: [
          { childId: 'c1', fullName: 'Grace Ade', onApp: true },
          { childId: 'c1', fullName: 'Femi Ade', onApp: false },
          { childId: 'c2', fullName: 'Kemi Bello', onApp: false },
        ],
      }),
    ),
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    exists: jest.fn().mockResolvedValue(false),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const checkInRepo: any = {
    createQueryBuilder: jest.fn(() =>
      chain({
        raw: [{ childId: 'c1', last: '2026-11-15T09:45:00Z' }],
        many: [],
      }),
    ),
  };
  const children: any = {
    guardianEntity: jest.fn((child, dto) => ({ child, ...dto })),
  };
  const service = new ChildrenChurchAdminService(
    childRepo,
    guardianRepo,
    checkInRepo,
    children,
    { searchActiveMembersLite: jest.fn() } as any,
  );
  return { service, list, childRepo, guardianRepo };
}

describe('ChildrenChurchAdminService', () => {
  it('lists children with their guardians, how many are on the app, last visit and totals', async () => {
    const { service } = setup();
    const res = await service.list({ page: 1, limit: 20 });
    expect(res.counts).toEqual({ total: 48, linked: 42, unlinked: 6 });
    expect(res.data[0]).toMatchObject({
      id: 'c1',
      guardians: ['Grace Ade', 'Femi Ade'],
      guardiansOnApp: 1,
      registeredBy: 'Funmi Lawal',
      lastVisit: '2026-11-15T09:45:00Z',
    });
    expect(res.data[1]).toMatchObject({
      guardiansOnApp: 0,
      lastVisit: null,
      registeredBy: null,
    });
  });

  it('filters to children with no parent on the app', async () => {
    const { service, list } = setup();
    await service.list({ page: 1, limit: 20, link: 'unlinked' });
    expect(list.andWhere).toHaveBeenCalledWith(
      expect.stringMatching(/^NOT EXISTS/),
    );
  });

  it('caps the page size', async () => {
    const { service, list } = setup();
    await service.list({ page: 1, limit: 500 });
    expect(list.take).toHaveBeenCalledWith(50);
  });

  it('refuses to add the same member twice to a child', async () => {
    const { service, childRepo, guardianRepo } = setup();
    childRepo.findOne.mockResolvedValue({ id: 'c1' });
    guardianRepo.exists.mockResolvedValue(true);
    await expect(
      service.addGuardian('c1', {
        fullName: 'Grace Ade',
        relationship: 'MOTHER' as any,
        memberId: 'm1',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(guardianRepo.save).not.toHaveBeenCalled();
  });

  it('404s linking a guardian that does not exist', async () => {
    const { service, guardianRepo } = setup();
    guardianRepo.findOne.mockResolvedValue(null);
    await expect(service.linkGuardian('g1', 'm1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('lists the teachers who handled visits recently, by name', async () => {
    const { service } = setup();
    (service as any).checkInRepo.query = jest
      .fn()
      .mockResolvedValue([{ id: 't1', firstname: 'Funmi', lastname: 'Lawal' }]);
    expect(await service.teachers()).toEqual([
      { id: 't1', name: 'Funmi Lawal' },
    ]);
  });
});
