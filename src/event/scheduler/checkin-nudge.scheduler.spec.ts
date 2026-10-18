import { formatInTimeZone } from 'date-fns-tz';
import { CheckinNudgeScheduler } from './checkin-nudge.scheduler';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';

describe('CheckinNudgeScheduler', () => {
  const MIN = 60_000;
  // 6:00 AM Lagos service; workers are late from 6:15.
  const start = new Date('2026-10-25T05:00:00Z');
  const slot = {
    id: 's1',
    name: 'First Service',
    startTime: start,
    endTime: new Date(start.getTime() + 120 * MIN),
    workerLateOverride: null,
    config: {
      workerLateOffsetSeconds: 15 * 60,
      checkinCloseMode: 'AFTER_START',
      checkinStopOffsetSeconds: 60 * 60,
    },
    checkinCloseModeOverride: null,
    checkinStopOverride: null,
    event: { id: 'e1', name: 'Sunday Service' },
  };

  let slots: unknown[] = [];
  let next: { startTime: Date } | null = null;
  const slotQb = () => {
    const qb: Record<string, jest.Mock> = {};
    for (const m of [
      'innerJoinAndSelect',
      'leftJoinAndSelect',
      'select',
      'where',
      'andWhere',
      'orderBy',
    ])
      qb[m] = jest.fn().mockReturnValue(qb);
    qb.getMany = jest.fn(() => Promise.resolve(slots));
    qb.getOne = jest.fn(() => Promise.resolve(next));
    return qb;
  };
  const slotRepo = { createQueryBuilder: jest.fn(slotQb) };
  const memberQb: Record<string, jest.Mock> = {};
  for (const m of ['select', 'where', 'andWhere', 'innerJoin'])
    memberQb[m] = jest.fn().mockReturnValue(memberQb);
  memberQb.getMany = jest.fn();
  const memberRepo = { createQueryBuilder: jest.fn(() => memberQb) };
  const sent = new Map<string, unknown>();
  const cache = {
    get: jest.fn((k: string) => Promise.resolve(sent.get(k))),
    set: jest.fn((k: string, v: unknown) => {
      sent.set(k, v);
      return Promise.resolve();
    }),
  };
  const settings = { getConfig: jest.fn() };
  const notifications = { notifyMember: jest.fn() };
  const scheduler = new CheckinNudgeScheduler(
    slotRepo as never,
    memberRepo as never,
    {} as never,
    {} as never,
    cache as never,
    {
      format: (d: Date, p: string, tz: string) => formatInTimeZone(d, tz, p),
    } as never,
    { get: jest.fn().mockResolvedValue('Africa/Lagos') } as never,
    settings as never,
    notifications as never,
  );
  const at = (minutesFromStart: number) =>
    new Date(start.getTime() + minutesFromStart * MIN);

  beforeEach(() => {
    jest.clearAllMocks();
    sent.clear();
    slots = [slot];
    next = null;
    settings.getConfig.mockResolvedValue({ enabled: true, thresholds: [15] });
    memberQb.getMany.mockResolvedValue([{ id: 'w1' }]);
  });

  it('nudges workers who haven’t checked in, 15 minutes before they’d be late', async () => {
    await scheduler.runNudges(at(1));
    await scheduler.runNudges(at(3));
    const calls = notifications.notifyMember.mock.calls.map((c) => c[0].push);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      memberIds: ['w1'],
      key: PushNotificationKey.CHECKIN_NUDGE_WORKER,
      vars: {
        service_name: 'Sunday Service · First Service',
        late_time: '6:15 AM',
      },
      url: '/events/e1',
      idempotencyKey: 'checkin-nudge:s1:worker:15',
    });
    expect(memberQb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('NOT EXISTS (SELECT 1 FROM attendances'),
      { eventId: 'e1' },
    );
  });

  it('nudges members 15 minutes before the service starts', async () => {
    await scheduler.runNudges(at(-14));
    const push = notifications.notifyMember.mock.calls[0][0].push;
    expect(push.key).toBe(PushNotificationKey.CHECKIN_NUDGE_MEMBER);
    expect(push.vars).toEqual({
      service_name: 'Sunday Service · First Service',
      start_time: '6:00 AM',
    });
  });

  it('uses the service’s own late allowance when it has one', async () => {
    slots = [{ ...slot, workerLateOverride: 30 * 60 }];
    await expect(scheduler.runNudges(at(1))).resolves.toEqual(at(15));
    expect(notifications.notifyMember).not.toHaveBeenCalled();
  });

  it('sends nothing when everyone has checked in', async () => {
    memberQb.getMany.mockResolvedValue([]);
    await scheduler.runNudges(at(1));
    expect(notifications.notifyMember).not.toHaveBeenCalled();
  });

  it('wakes for the next nudge, and sleeps until a later service comes within reach', async () => {
    await expect(scheduler.runNudges(at(-60))).resolves.toEqual(at(-15));
    slots = [];
    next = { startTime: at(600) };
    await expect(scheduler.runNudges(at(-60))).resolves.toEqual(at(585));
  });

  it('does nothing when check-in reminders are off', async () => {
    settings.getConfig.mockResolvedValue({ enabled: false, thresholds: [15] });
    await expect(scheduler.runNudges(at(1))).resolves.toBeNull();
    expect(slotRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('reminds everyone before the start when no one can be late', async () => {
    slots = [{ ...slot, workerLateOverride: 2 * 60 * 60 }];
    await scheduler.runNudges(at(-14));
    const calls = notifications.notifyMember.mock.calls.map((c) => c[0].push);
    expect(calls).toHaveLength(1);
    expect(calls[0].key).toBe(PushNotificationKey.CHECKIN_NUDGE_MEMBER);
    expect(calls[0].idempotencyKey).toBe('checkin-nudge:s1:everyone:15');
    expect(memberQb.andWhere).not.toHaveBeenCalledWith(
      expect.stringContaining('m.role'),
      expect.anything(),
    );
  });

  it('leaves out services whose config has check-in reminders off', async () => {
    await scheduler.runNudges(at(1));
    const qb = slotRepo.createQueryBuilder.mock.results[0].value;
    expect(qb.andWhere).toHaveBeenCalledWith(
      '(config.id IS NULL OR config.sendCheckinReminders = true)',
    );
  });
});
