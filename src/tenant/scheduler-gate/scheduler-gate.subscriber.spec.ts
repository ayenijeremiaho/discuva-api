import { SchedulerGateSubscriber } from './scheduler-gate.subscriber';
import { Tenant } from '../entity/tenant.entity';
import { EventReminder } from '../../event/entity/event-reminder.entity';
import { ServiceSlot } from '../../event/entity/service-slot.entity';
import { RentalBooking } from '../../facility-rental/entity/rental-booking.entity';
import { ServiceSession } from '../../service-programme/entity/service-session.entity';
import { ClassSession } from '../../classes/entity/class-session.entity';
import { ChurchSetting } from '../../church-settings/entity/church-setting.entity';
import { Member } from '../../member/entity/member.entity';

describe('SchedulerGateSubscriber', () => {
  const gate = {
    wake: jest.fn().mockResolvedValue(undefined),
    invalidateTenants: jest.fn(),
  };
  const dataSource = { subscribers: [] as unknown[] };
  const subscriber = new SchedulerGateSubscriber(
    dataSource as never,
    gate as never,
  );
  const ev = (target: unknown) => ({ metadata: { target } }) as never;

  beforeEach(() => jest.clearAllMocks());

  it('registers itself so it sees every write, whichever service makes it', () => {
    expect(dataSource.subscribers).toContain(subscriber);
  });

  it.each([
    ['a reminder', EventReminder, ['event-reminders']],
    [
      'a service slot',
      ServiceSlot,
      ['programme-auto-start', 'absence-marking', 'event-reminders'],
    ],
    ['a rental booking', RentalBooking, ['rental-status']],
    [
      'a live service session (unblocks the next auto-start)',
      ServiceSession,
      ['programme-auto-start'],
    ],
    ['a class session', ClassSession, ['class-session-reminders']],
    ['reminder settings', ChurchSetting, ['class-session-reminders']],
  ])('wakes the jobs that depend on %s', (_label, target, jobs) => {
    subscriber.afterInsert(ev(target));
    subscriber.afterUpdate(ev(target));
    subscriber.afterRemove(ev(target));
    expect(gate.wake).toHaveBeenCalledTimes(3);
    expect(gate.wake).toHaveBeenCalledWith(jobs);
  });

  it('refreshes the church list when a church is added or changed', () => {
    subscriber.afterUpdate(ev(Tenant));
    expect(gate.invalidateTenants).toHaveBeenCalled();
    expect(gate.wake).not.toHaveBeenCalled();
  });

  it('ignores unrelated tables', () => {
    subscriber.afterInsert(ev(Member));
    expect(gate.wake).not.toHaveBeenCalled();
  });
});
