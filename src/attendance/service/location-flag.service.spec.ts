import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LocationFlagService } from './location-flag.service';
import { Attendance } from '../entity/attendance.entity';
import { LocationFlagEnum } from '../util/location-flags';

function chain(result: { raw?: unknown[] } = {}) {
  const qb: Record<string, jest.Mock> = {};
  for (const m of [
    'innerJoin',
    'select',
    'addSelect',
    'where',
    'andWhere',
    'orderBy',
    'limit',
    'update',
    'set',
    'whereInIds',
  ]) {
    qb[m] = jest.fn().mockReturnValue(qb);
  }
  qb.getRawMany = jest.fn().mockResolvedValue(result.raw ?? []);
  qb.execute = jest.fn().mockResolvedValue({ affected: 1 });
  return qb;
}

describe('LocationFlagService.verify', () => {
  const repo = {
    findOne: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn(),
  };
  let service: LocationFlagService;
  const precise = {
    latitude: 6.524412345,
    longitude: 3.379198761,
    accuracy: 18,
  };
  const record = (location: unknown, locationFlags: string[] = []) => ({
    id: 'att-1',
    location,
    locationFlags,
    member: { id: 'm1' },
    event: { id: 'e1' },
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        LocationFlagService,
        { provide: getRepositoryToken(Attendance), useValue: repo },
      ],
    }).compile();
    service = module.get(LocationFlagService);
  });

  it('finds nothing for an ordinary check-in and saves no new flags', async () => {
    repo.findOne.mockResolvedValue(record(precise));
    repo.createQueryBuilder
      .mockReturnValueOnce(chain())
      .mockReturnValueOnce(chain());

    await expect(service.verify('att-1')).resolves.toEqual({
      locationFlags: [],
      compared: true,
      repeatedAt: [],
      sharedWith: [],
    });
    expect(repo.update).toHaveBeenCalledWith('att-1', { locationFlags: [] });
  });

  it('reports earlier services and other people at the identical spot, and flags them too', async () => {
    repo.findOne.mockResolvedValue(
      record(precise, [LocationFlagEnum.PERFECT_ACCURACY]),
    );
    const history = chain({
      raw: [
        { eventId: 'e0', eventName: 'Sunday Service', eventDate: '2026-10-11' },
      ],
    });
    const others = chain({
      raw: [{ id: 'att-2', memberId: 'm2', firstname: 'Ben', lastname: 'Eze' }],
    });
    const markOthers = chain();
    repo.createQueryBuilder
      .mockReturnValueOnce(history)
      .mockReturnValueOnce(others)
      .mockReturnValueOnce(markOthers);

    const result = await service.verify('att-1');

    expect(result.locationFlags).toEqual([
      LocationFlagEnum.PERFECT_ACCURACY,
      LocationFlagEnum.REPEATED_SPOT,
      LocationFlagEnum.SHARED_SPOT,
    ]);
    expect(result.repeatedAt).toHaveLength(1);
    expect(result.sharedWith).toEqual([
      { memberId: 'm2', firstname: 'Ben', lastname: 'Eze' },
    ]);
    expect(history.where).toHaveBeenCalledWith('a.member_id = :memberId', {
      memberId: 'm1',
    });
    expect(others.where).toHaveBeenCalledWith('a.event_id = :eventId', {
      eventId: 'e1',
    });
    expect(markOthers.whereInIds).toHaveBeenCalledWith(['att-2']);
  });

  it('skips the comparisons for a rough fix, which legitimately repeats', async () => {
    repo.findOne.mockResolvedValue(record({ ...precise, accuracy: 900 }));
    const result = await service.verify('att-1');
    expect(result.compared).toBe(false);
    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('rejects a missing record or one with no location', async () => {
    repo.findOne.mockResolvedValueOnce(null);
    await expect(service.verify('x')).rejects.toThrow(NotFoundException);
    repo.findOne.mockResolvedValueOnce(record(null));
    await expect(service.verify('att-1')).rejects.toThrow(BadRequestException);
  });
});
