import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BlockedCheckinService,
  radiusNeededToPass,
} from './blocked-checkin.service';
import {
  BlockedCheckin,
  BlockedCheckinReasonEnum,
} from '../entity/blocked-checkin.entity';
import { Attendance } from '../entity/attendance.entity';

function qbReturning(result: { many?: unknown; raw?: unknown }) {
  const qb: Record<string, jest.Mock> = {};
  for (const m of [
    'leftJoin',
    'addSelect',
    'select',
    'orderBy',
    'skip',
    'take',
    'where',
    'andWhere',
  ]) {
    qb[m] = jest.fn().mockReturnValue(qb);
  }
  qb.getManyAndCount = jest.fn().mockResolvedValue(result.many);
  qb.getRawMany = jest.fn().mockResolvedValue(result.raw);
  return qb;
}

describe('radiusNeededToPass', () => {
  it('matches the check-in rule: d - min(accuracy, r) <= r', () => {
    expect(radiusNeededToPass(80, null)).toBe(80);
    expect(radiusNeededToPass(80, 30)).toBe(50);
    expect(radiusNeededToPass(80, 60)).toBe(40);
  });
});

describe('BlockedCheckinService', () => {
  const blockedRepo = { query: jest.fn(), createQueryBuilder: jest.fn() };
  const attendanceRepo = { createQueryBuilder: jest.fn() };
  let service: BlockedCheckinService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        BlockedCheckinService,
        { provide: getRepositoryToken(BlockedCheckin), useValue: blockedRepo },
        { provide: getRepositoryToken(Attendance), useValue: attendanceRepo },
      ],
    }).compile();
    service = module.get(BlockedCheckinService);
  });

  const attempt = {
    memberId: 'm1',
    eventId: 'e1',
    serviceSlotId: 's1',
    distanceMeters: 87.6,
    accuracyMeters: 24.4,
    allowedDistanceMeters: 50,
    reason: BlockedCheckinReasonEnum.TOO_FAR,
    at: new Date('2026-10-18T09:00:00Z'),
  };

  it('upserts one row per member and event, keeping the closest reading', async () => {
    blockedRepo.query.mockResolvedValue([]);
    await service.record(attempt);

    const [sql, params] = blockedRepo.query.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (member_id, event_id)');
    expect(sql).toContain('attempts = blocked_checkins.attempts + 1');
    expect(sql).toContain('LEAST(');
    expect(params).toEqual([
      'm1',
      'e1',
      's1',
      88,
      24,
      50,
      'TOO_FAR',
      attempt.at,
    ]);
  });

  it('lets a failed write throw for the after-rollback runner to log', async () => {
    blockedRepo.query.mockRejectedValue(new Error('db down'));
    await expect(service.record(attempt)).rejects.toThrow('db down');
  });

  it('lists attempts with whether the person checked in later and the radius that would have passed', async () => {
    const row = {
      id: 'b1',
      member: { id: 'm1', firstname: 'Ada', lastname: 'Obi', photoUrl: null },
      event: { id: 'e1', name: 'Sunday Service', eventDate: '2026-10-18' },
      serviceSlot: { id: 's1', name: 'First Service' },
      attempts: 3,
      closestDistanceMeters: 80,
      accuracyMeters: 30,
      allowedDistanceMeters: 50,
      reason: BlockedCheckinReasonEnum.TOO_FAR,
      lastAttemptAt: attempt.at,
    };
    const imprecise = {
      ...row,
      id: 'b2',
      member: { ...row.member, id: 'm2' },
      closestDistanceMeters: 1400,
      accuracyMeters: 2000,
      reason: BlockedCheckinReasonEnum.IMPRECISE_LOCATION,
    };
    const listQb = qbReturning({ many: [[row, imprecise], 2] });
    blockedRepo.createQueryBuilder.mockReturnValue(listQb);
    attendanceRepo.createQueryBuilder.mockReturnValue(
      qbReturning({ raw: [{ member_id: 'm1', event_id: 'e1' }] }),
    );

    const result = await service.list(1, 20, 'e1');

    expect(listQb.where).toHaveBeenCalledWith('b.event_id = :eventId', {
      eventId: 'e1',
    });
    expect(result.totalCount).toBe(2);
    expect(result.data[0]).toMatchObject({
      id: 'b1',
      checkedInLater: true,
      wouldPassAtMeters: 50,
    });
    expect(result.data[1]).toMatchObject({
      checkedInLater: false,
      wouldPassAtMeters: null,
    });
  });

  it('skips the attendance lookup when nothing was blocked', async () => {
    blockedRepo.createQueryBuilder.mockReturnValue(
      qbReturning({ many: [[], 0] }),
    );
    const result = await service.list();
    expect(result.data).toEqual([]);
    expect(attendanceRepo.createQueryBuilder).not.toHaveBeenCalled();
  });
});
