import { CHURCH_TIMEZONE } from '../../utility/constants/app.constants';

// Today's calendar date (YYYY-MM-DD) where the church is.
export function todayInChurchTz(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: CHURCH_TIMEZONE });
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
