import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RotaSetupService } from './rota-setup.service';
import {
  RotaAllocationMode,
  RotaScheduleType,
} from '../enum/rota-allocation-mode.enum';

describe('RotaSetupService', () => {
  const repo = () => ({
    query: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => ({ id: 'saved', ...value })),
    remove: jest.fn(),
  });
  const subteams = repo();
  const responsibilities = repo();
  const eligibility = repo();
  const planners = repo();
  const schedules = repo();
  const manager = { query: jest.fn() };
  const audit = { log: jest.fn() };
  const service = new RotaSetupService(
    subteams as never,
    responsibilities as never,
    eligibility as never,
    planners as never,
    schedules as never,
    { tx: manager } as never,
    audit as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    subteams.query.mockResolvedValue([
      {
        is_leader: true,
        is_member: true,
        is_planner: false,
        can_publish: false,
      },
    ]);
  });

  it('keeps rota structure changes with the department leads', async () => {
    subteams.query.mockResolvedValueOnce([
      {
        is_leader: false,
        is_member: true,
        is_planner: true,
        can_publish: true,
      },
    ]);

    await expect(
      service.createSubteam('member', 'department', { name: 'Vocals' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(subteams.save).not.toHaveBeenCalled();
  });

  it('creates a generic per-service schedule without custom times', async () => {
    const saved = await service.createSchedule('leader', 'department', {
      name: 'Church services',
      scheduleType: RotaScheduleType.SERVICE_SLOTS,
      allocationMode: RotaAllocationMode.AUTOMATIC,
    });

    expect(saved).toMatchObject({
      name: 'Church services',
      scheduleType: RotaScheduleType.SERVICE_SLOTS,
      dayOfWeek: null,
      startTime: null,
      endTime: null,
    });
  });

  it('requires complete, ordered times for an independent schedule', async () => {
    await expect(
      service.createSchedule('leader', 'department', {
        name: 'Weekly classes',
        scheduleType: RotaScheduleType.CUSTOM,
        allocationMode: RotaAllocationMode.MANUAL,
        dayOfWeek: 0,
        startTime: '10:00',
        endTime: '09:30',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('replaces eligibility in bulk after checking active team membership', async () => {
    responsibilities.findOne.mockResolvedValue({ id: 'responsibility' });
    subteams.query
      .mockResolvedValueOnce([
        {
          is_leader: true,
          is_member: true,
          is_planner: false,
          can_publish: false,
        },
      ])
      .mockResolvedValueOnce([{ member_id: 'm1' }, { member_id: 'm2' }]);
    manager.query.mockResolvedValue([]);

    await expect(
      service.saveEligibility('leader', 'department', 'responsibility', {
        members: [{ memberId: 'm1', isFixed: true }, { memberId: 'm2' }],
      }),
    ).resolves.toEqual({ count: 2 });
    expect(manager.query).toHaveBeenCalledTimes(2);
    expect(manager.query.mock.calls[1][1]).toEqual([
      'responsibility',
      ['m1', 'm2'],
      [true, false],
    ]);
  });

  it('rejects duplicate eligibility before writing', async () => {
    responsibilities.findOne.mockResolvedValue({ id: 'responsibility' });

    await expect(
      service.saveEligibility('leader', 'department', 'responsibility', {
        members: [{ memberId: 'm1' }, { memberId: 'm1' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.query).not.toHaveBeenCalled();
  });
});
