import { ProgrammeAutoEndScheduler } from './programme-auto-end.scheduler';

const NOW = new Date('2026-11-01T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe('ProgrammeAutoEndScheduler', () => {
  const repo = { query: jest.fn() };
  const sessions = {
    end: jest.fn().mockResolvedValue({}),
    getState: jest.fn().mockResolvedValue({}),
  };
  const gateway = {
    hasOpenScreens: jest.fn().mockResolvedValue(false),
    broadcastState: jest.fn(),
  };
  const settings = { getConfig: jest.fn() };
  const scheduler = new ProgrammeAutoEndScheduler(
    repo as never,
    sessions as never,
    gateway as never,
    settings as never,
    {} as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    settings.getConfig.mockResolvedValue({ enabled: true, thresholds: [60] });
    gateway.hasOpenScreens.mockResolvedValue(false);
  });

  it("doesn't cut off a late service while its screen is open, and checks again soon", async () => {
    repo.query.mockResolvedValue([
      { session_code: 'LATE', active_until: hoursAgo(3) },
    ]);
    gateway.hasOpenScreens.mockResolvedValue(true);
    const next = await scheduler.runAutoEnd(NOW);
    expect(sessions.end).not.toHaveBeenCalled();
    expect(next).toEqual(new Date(NOW.getTime() + 15 * 60_000));
  });

  it('ends a session whose screen was simply left open for too long', async () => {
    repo.query.mockResolvedValue([
      { session_code: 'TV', active_until: hoursAgo(13) },
    ]);
    gateway.hasOpenScreens.mockResolvedValue(true);
    await scheduler.runAutoEnd(NOW);
    expect(sessions.end).toHaveBeenCalledTimes(1);
    expect(gateway.broadcastState).toHaveBeenCalled();
  });

  it('ends a forgotten session, dated when it should have ended', async () => {
    repo.query.mockResolvedValue([
      { session_code: 'OLD', active_until: hoursAgo(72) },
    ]);
    await expect(scheduler.runAutoEnd(NOW)).resolves.toBeNull();
    expect(sessions.end).toHaveBeenCalledWith(
      'OLD',
      null,
      'Ended automatically',
      hoursAgo(71),
    );
  });

  it('leaves a session still within its grace, and wakes when that runs out', async () => {
    repo.query.mockResolvedValue([
      { session_code: 'NOW', active_until: hoursAgo(0.5) },
    ]);
    const next = await scheduler.runAutoEnd(NOW);
    expect(sessions.end).not.toHaveBeenCalled();
    expect(next).toEqual(new Date(hoursAgo(0.5).getTime() + 3_600_000));
  });

  it('does nothing and sleeps when nothing is live', async () => {
    repo.query.mockResolvedValue([]);
    await expect(scheduler.runAutoEnd(NOW)).resolves.toBeNull();
  });

  it('can be switched off by the church', async () => {
    settings.getConfig.mockResolvedValue({ enabled: false, thresholds: [60] });
    await expect(scheduler.runAutoEnd(NOW)).resolves.toBeNull();
    expect(repo.query).not.toHaveBeenCalled();
  });

  it('carries on after one session fails', async () => {
    repo.query.mockResolvedValue([
      { session_code: 'BAD', active_until: hoursAgo(5) },
      { session_code: 'GOOD', active_until: hoursAgo(5) },
    ]);
    sessions.end.mockRejectedValueOnce(new Error('boom'));
    await scheduler.runAutoEnd(NOW);
    expect(sessions.end).toHaveBeenCalledTimes(2);
  });
});
