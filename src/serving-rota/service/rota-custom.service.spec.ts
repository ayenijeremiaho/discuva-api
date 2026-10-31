import { ForbiddenException } from '@nestjs/common';
import { RotaCustomService } from './rota-custom.service';

describe('RotaCustomService', () => {
  const assignments = { query: jest.fn() };
  const manager = { query: jest.fn() };
  const timezone = { get: jest.fn().mockResolvedValue('Africa/Lagos') };
  const notifications = { notifyMember: jest.fn() };
  const audit = { log: jest.fn() };
  const gate = { wake: jest.fn() };
  const service = new RotaCustomService(
    assignments as never,
    { tx: manager } as never,
    timezone as never,
    notifications as never,
    audit as never,
    gate as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    assignments.query.mockImplementation((sql: string) => {
      if (sql.includes('AS is_leader'))
        return Promise.resolve([
          {
            is_leader: true,
            is_member: true,
            can_plan: false,
            can_publish: false,
          },
        ]);
      if (sql.includes("schedule_type = 'CUSTOM'"))
        return Promise.resolve([
          {
            id: 'schedule',
            name: 'Weekly classes',
            day_of_week: 0,
            start_time: '10:00:00',
            end_time: '10:45:00',
          },
        ]);
      if (sql.includes('GROUP BY a.schedule_id')) return Promise.resolve([]);
      return Promise.resolve([]);
    });
  });

  it('creates upcoming occurrences from any department custom schedule', async () => {
    const result = await service.list(
      'leader',
      'department',
      new Date('2030-06-01T09:00:00Z'),
    );

    expect(result.sessions.length).toBeGreaterThanOrEqual(8);
    expect(result.sessions[0]).toMatchObject({
      scheduleId: 'schedule',
      name: 'Weekly classes',
      assigned: 0,
      mine: false,
    });
    expect(result.sessions[0].startTime).toBeInstanceOf(Date);
  });

  it('does not let a read-only planner publish', async () => {
    assignments.query.mockImplementation((sql: string) => {
      if (sql.includes('AS is_leader'))
        return Promise.resolve([
          {
            is_leader: false,
            is_member: true,
            can_plan: true,
            can_publish: false,
          },
        ]);
      return Promise.resolve([]);
    });

    await expect(
      service.save(
        'planner',
        'department',
        'schedule',
        '2030-06-09',
        [],
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
