import { ServiceReminderScheduler } from './service-reminder.scheduler';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';

describe('ServiceReminderScheduler', () => {
  const HOUR = 3_600_000;
  const now = new Date('2026-10-24T09:00:00Z');
  const slot = (id: string, hoursAway: number, name = 'First Service') => ({
    id,
    name,
    startTime: new Date(now.getTime() + hoursAway * HOUR),
    event: { id: `e-${id}`, name: 'Sunday Service' },
  });

  let inReach: ReturnType<typeof slot>[] = [];
  let next: { startTime: Date } | null = null;
  const slotQb = () => {
    const qb: Record<string, jest.Mock> = {};
    for (const m of [
      'innerJoinAndSelect',
      'leftJoin',
      'select',
      'where',
      'andWhere',
      'orderBy',
    ])
      qb[m] = jest.fn().mockReturnValue(qb);
    qb.getMany = jest.fn(() => Promise.resolve(inReach));
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
  const scheduler = new ServiceReminderScheduler(
    slotRepo as never,
    memberRepo as never,
    {} as never,
    {} as never,
    cache as never,
    settings as never,
    notifications as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    sent.clear();
    inReach = [];
    next = null;
    settings.getConfig.mockResolvedValue({
      enabled: true,
      thresholds: [24, 2],
    });
    memberQb.getMany.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);
  });

  it('reminds the people the service is for the day before, once', async () => {
    inReach = [slot('s1', 24 - 0.1)];
    await scheduler.runReminders(now);
    await scheduler.runReminders(now);
    expect(notifications.notifyMember).toHaveBeenCalledTimes(1);
    expect(notifications.notifyMember).toHaveBeenCalledWith({
      category: EmailCategory.EVENT_REMINDER,
      push: {
        memberIds: ['m1', 'm2'],
        key: PushNotificationKey.SERVICE_REMINDER,
        vars: {
          service_name: 'Sunday Service · First Service',
          time_until: '1 day',
        },
        url: '/events/e-s1',
        idempotencyKey: 'service-reminder:s1:24',
      },
    });
  });

  it('sends the 2-hour reminder separately, and names a single-service event once', async () => {
    inReach = [slot('s1', 1.9, 'Sunday Service')];
    await scheduler.runReminders(now);
    expect(notifications.notifyMember.mock.calls[0][0].push.vars).toEqual({
      service_name: 'Sunday Service',
      time_until: '2 hours',
    });
  });

  it('wakes for the next reminder due, without sending early', async () => {
    inReach = [slot('s1', 20)];
    await expect(scheduler.runReminders(now)).resolves.toEqual(
      new Date(now.getTime() + 18 * HOUR),
    );
    expect(notifications.notifyMember).not.toHaveBeenCalled();
  });

  it('sleeps until the next service comes within reach when none is close', async () => {
    next = { startTime: new Date(now.getTime() + 100 * HOUR) };
    await expect(scheduler.runReminders(now)).resolves.toEqual(
      new Date(now.getTime() + 76 * HOUR),
    );
  });

  it('skips a reminder whose moment passed long ago', async () => {
    inReach = [slot('s1', 0.5)];
    await scheduler.runReminders(now);
    expect(notifications.notifyMember).not.toHaveBeenCalled();
  });

  it('does nothing when the church turned service reminders off', async () => {
    settings.getConfig.mockResolvedValue({ enabled: false, thresholds: [24] });
    await expect(scheduler.runReminders(now)).resolves.toBeNull();
    expect(slotRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('sends nothing when no one is in the audience', async () => {
    inReach = [slot('s1', 1.9)];
    memberQb.getMany.mockResolvedValue([]);
    await scheduler.runReminders(now);
    expect(notifications.notifyMember).not.toHaveBeenCalled();
  });
});
