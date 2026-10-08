import { computeStreak, currentWeekStart } from './note-streak';

describe('note-streak', () => {
  const thisWeek = '2026-10-05';

  it('counts consecutive weeks including this one', () => {
    expect(
      computeStreak(['2026-10-05', '2026-09-28', '2026-09-21'], thisWeek),
    ).toEqual({
      current: 3,
      best: 3,
      thisWeek: true,
    });
  });

  it("keeps the streak alive while this week's note is still to come", () => {
    expect(computeStreak(['2026-09-28', '2026-09-21'], thisWeek)).toEqual({
      current: 2,
      best: 2,
      thisWeek: false,
    });
  });

  it('breaks after a full missed week but remembers the best run', () => {
    expect(
      computeStreak(
        ['2026-09-21', '2026-08-31', '2026-08-24', '2026-08-17'],
        thisWeek,
      ),
    ).toEqual({ current: 0, best: 3, thisWeek: false });
  });

  it('handles no notes', () => {
    expect(computeStreak([], thisWeek)).toEqual({
      current: 0,
      best: 0,
      thisWeek: false,
    });
  });

  it("uses the church's timezone for the week boundary", () => {
    // Sunday 23:30 UTC is already Monday in Lagos (UTC+1).
    const now = new Date('2026-10-11T23:30:00Z');
    expect(currentWeekStart('Africa/Lagos', now)).toBe('2026-10-12');
    expect(currentWeekStart('UTC', now)).toBe('2026-10-05');
  });
});
