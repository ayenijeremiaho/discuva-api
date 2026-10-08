import { format, startOfISOWeek, subWeeks, parseISO } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

export interface NoteStreak {
  current: number;
  best: number;
  thisWeek: boolean;
}

// Monday of the current week in the church's timezone, as yyyy-MM-dd (matches Postgres date_trunc('week')).
export function currentWeekStart(timezone: string, now = new Date()): string {
  return format(startOfISOWeek(toZonedTime(now, timezone)), 'yyyy-MM-dd');
}

const previousWeek = (week: string) =>
  format(subWeeks(parseISO(week), 1), 'yyyy-MM-dd');

// `weeks` are the Mondays of weeks with a sermon note, newest first. A streak survives until a full week is missed,
// so this week counts as pending rather than broken.
export function computeStreak(
  weeks: string[],
  thisWeekStart: string,
): NoteStreak {
  const has = new Set(weeks);
  const thisWeek = has.has(thisWeekStart);

  let current = 0;
  let cursor = thisWeek ? thisWeekStart : previousWeek(thisWeekStart);
  while (has.has(cursor)) {
    current++;
    cursor = previousWeek(cursor);
  }

  let best = 0;
  let run = 0;
  let expected: string | null = null;
  for (const week of [...has].sort().reverse()) {
    run = week === expected ? run + 1 : 1;
    best = Math.max(best, run);
    expected = previousWeek(week);
  }

  return { current, best, thisWeek };
}
