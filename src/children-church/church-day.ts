import { fromZonedTime } from 'date-fns-tz';
import { localDate } from '../event/types/slot-blueprint';

const DAY_MS = 24 * 60 * 60 * 1000;

// The church-local calendar day containing `now`, as a date string and UTC bounds.
export function churchDay(
  timezone: string,
  now: Date = new Date(),
): { ymd: string; start: Date; end: Date } {
  const ymd = localDate(now, timezone);
  const start = fromZonedTime(`${ymd}T00:00:00`, timezone);
  return { ymd, start, end: new Date(start.getTime() + DAY_MS) };
}

export const personName = (
  m?: { firstname?: string | null; lastname?: string | null } | null,
): string | null =>
  m ? `${m.firstname ?? ''} ${m.lastname ?? ''}`.trim() || null : null;
