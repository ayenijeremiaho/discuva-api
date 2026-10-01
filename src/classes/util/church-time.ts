import { CHURCH_TIMEZONE } from '../../utility/constants/app.constants';

function offsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

// "2026-10-04" + "09:00" in the church's timezone → the real instant, DST-safe.
export function wallTimeToUtc(
  date: string,
  time: string,
  tz = CHURCH_TIMEZONE,
): Date {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - offsetMs(new Date(guess), tz);
  return new Date(guess - offsetMs(new Date(first), tz));
}

// Calendar date (YYYY-MM-DD) of an instant in the church's timezone.
export function churchDateOf(at: Date, tz = CHURCH_TIMEZONE): string {
  return at.toLocaleDateString('en-CA', { timeZone: tz });
}
