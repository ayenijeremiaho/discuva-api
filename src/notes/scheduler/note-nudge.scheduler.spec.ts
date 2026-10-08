import { NoteNudgeScheduler } from './note-nudge.scheduler';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';

jest.mock('../../tenant/utility/run-in-tenant-context', () => ({
  runInTenantContext: (
    _cls: unknown,
    _tx: unknown,
    _t: unknown,
    fn: () => unknown,
  ) => fn(),
}));

describe('NoteNudgeScheduler', () => {
  const tenant = {
    id: 't1',
    schemaName: 's1',
    subdomain: 'one',
    timezone: 'Africa/Lagos',
  };
  const gate = { activeTenants: jest.fn().mockResolvedValue([tenant]) };
  const cacheService = {
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn(),
  };
  const query = jest.fn();
  const txHost = { tx: { query: (...a: unknown[]) => query(...a) } };
  const churchSettings = { isEnabled: jest.fn().mockResolvedValue(true) };
  const planFeatures = {
    resolve: jest
      .fn()
      .mockResolvedValue({ features: ['notes'], overrides: {} }),
  };
  const push = { dispatchToMemberIds: jest.fn().mockResolvedValue(undefined) };
  let scheduler: NoteNudgeScheduler;

  // Lagos is UTC+1 all year.
  const lagos = (iso: string) => new Date(`${iso}+01:00`);

  beforeEach(() => {
    jest.clearAllMocks();
    gate.activeTenants.mockResolvedValue([tenant]);
    churchSettings.isEnabled.mockResolvedValue(true);
    planFeatures.resolve.mockResolvedValue({
      features: ['notes'],
      overrides: {},
    });
    query.mockResolvedValue([]);
    scheduler = new NoteNudgeScheduler(
      gate as any,
      cacheService as any,
      { get: jest.fn() } as any,
      {} as any,
      txHost as any,
      churchSettings as any,
      planFeatures as any,
      push as any,
    );
  });

  it("does nothing outside the church's nudge hours", async () => {
    await scheduler.run(lagos('2026-10-11T15:05:00'));
    expect(query).not.toHaveBeenCalled();
  });

  it('sends one evening push per service to attendees without notes', async () => {
    query.mockResolvedValueOnce([
      {
        memberId: 'm1',
        eventId: 'e1',
        eventName: 'Sunday Service',
        slotId: 's1',
      },
      {
        memberId: 'm2',
        eventId: 'e1',
        eventName: 'Sunday Service',
        slotId: 's1',
      },
      {
        memberId: 'm3',
        eventId: 'e1',
        eventName: 'Sunday Service',
        slotId: 's2',
      },
    ]);
    await scheduler.run(lagos('2026-10-11T19:05:00'));
    expect(query.mock.calls[0][0]).toContain('m.note_nudges');
    expect(query.mock.calls[0][0]).toContain('NOT EXISTS');
    expect(push.dispatchToMemberIds).toHaveBeenCalledTimes(2);
    expect(push.dispatchToMemberIds).toHaveBeenCalledWith(['m1', 'm2'], {
      key: PushNotificationKey.NOTE_EVENING_NUDGE,
      vars: { service_name: 'Sunday Service' },
      url: '/notes/new?slot=s1',
      idempotencyKey: 'note-evening:e1',
    });
  });

  it('reminds members of their weekly step on Monday morning, shortened for the push', async () => {
    query.mockResolvedValueOnce([
      { memberId: 'm1', id: 'n1', commitment: 'x'.repeat(150) },
    ]);
    await scheduler.run(lagos('2026-10-12T08:05:00'));
    const [, payload] = push.dispatchToMemberIds.mock.calls[0];
    expect(payload).toMatchObject({
      key: PushNotificationKey.NOTE_COMMITMENT_REMINDER,
      url: '/notes/n1',
      idempotencyKey: 'note-commitment:n1',
    });
    expect(payload.vars.commitment.length).toBeLessThanOrEqual(90);
  });

  it('skips churches without the Notes module or plan', async () => {
    churchSettings.isEnabled.mockResolvedValueOnce(false);
    await scheduler.run(lagos('2026-10-11T19:05:00'));
    planFeatures.resolve.mockResolvedValueOnce({ features: [], overrides: {} });
    await scheduler.run(lagos('2026-10-11T19:05:00'));
    expect(query).not.toHaveBeenCalled();
  });

  it('lets a platform override switch notes on regardless of plan', async () => {
    planFeatures.resolve.mockResolvedValueOnce({
      features: [],
      overrides: { notes: true },
    });
    await scheduler.run(lagos('2026-10-11T19:05:00'));
    expect(query).toHaveBeenCalled();
  });

  it('skips the run when another instance holds the lock', async () => {
    cacheService.acquireLock.mockResolvedValueOnce(false);
    await scheduler.run(lagos('2026-10-11T19:05:00'));
    expect(gate.activeTenants).not.toHaveBeenCalled();
  });
});
