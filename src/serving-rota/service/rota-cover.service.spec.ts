import { ForbiddenException } from '@nestjs/common';
import { RotaCoverService } from './rota-cover.service';

describe('RotaCoverService', () => {
  const repo = { query: jest.fn() };
  const notifications = {
    notifyMember: jest.fn().mockResolvedValue(undefined),
  };
  const service = new RotaCoverService(
    repo as never,
    { get: jest.fn().mockResolvedValue('Africa/Lagos') } as never,
    { format: () => 'Sun 8 Nov, 10:00 AM' } as never,
    notifications as never,
    { log: jest.fn() } as never,
  );
  const NOW = new Date('2026-11-01T08:00:00Z');
  const duty = {
    id: 'a1',
    member_id: 'm1',
    role: 'Teacher',
    occurrence_date: '2026-11-08',
    schedule_id: 's1',
    name: 'Classes',
    start_time: '10:00:00',
    end_time: '11:00:00',
    department_id: 'd1',
    department_name: 'Sunday School',
    member_name: 'Ada',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    repo.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM rota_custom_assignments a JOIN rota_schedules s'))
        return Promise.resolve([duty]);
      if (sql.includes('FROM worker_profiles wp JOIN members m'))
        return Promise.resolve([
          { id: 'm2', name: 'Ben', photo_url: null, matches_role: true },
        ]);
      if (sql.includes('INSERT INTO rota_cover_requests'))
        return Promise.resolve([{ id: 'c1' }]);
      return Promise.resolve([]);
    });
  });

  it('asks only people who are free and right for the responsibility', async () => {
    const result = await service.requestCustom('m1', 'a1', {}, NOW);
    expect(result).toEqual({ id: 'c1', notified: 1 });
    expect(notifications.notifyMember.mock.calls[0][0].push.memberIds).toEqual([
      'm2',
    ]);
  });

  it('only lets you ask for your own duty', async () => {
    await expect(service.requestCustom('x', 'a1', {}, NOW)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses a named person who cannot cover', async () => {
    await expect(
      service.requestCustom('m1', 'a1', { targetMemberId: 'm9' }, NOW),
    ).rejects.toThrow("can't cover");
  });
});
