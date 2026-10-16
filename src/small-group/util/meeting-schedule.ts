import { BadRequestException } from '@nestjs/common';
import { fromZonedTime } from 'date-fns-tz';
import { MeetingFrequencyEnum } from '../enum/meeting-frequency.enum';
import { addDays, dayDiff, localDate } from '../../event/types/slot-blueprint';

export interface MeetingSchedule {
  frequency: MeetingFrequencyEnum;
  // 0 = Sunday … 6 = Saturday.
  weekday: number | null;
  // 'HH:mm', church-local.
  startTime: string | null;
  endTime: string | null;
  // WEEKLY only: 1 = every week, 2 = every other week, up to 4.
  intervalWeeks: number;
  // MONTHLY only: 1–4 for the first to fourth weekday of the month, -1 for the last.
  weekOfMonth: number | null;
  // 'YYYY-MM-DD'. Nothing before it counts; for every 2–4 weeks it sets which weeks.
  startsOn: string | null;
}

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const ORDINALS: Record<number, string> = {
  1: 'first',
  2: 'second',
  3: 'third',
  4: 'fourth',
  [-1]: 'last',
};
// Long enough to hold at least one meeting for any schedule (monthly is at most 5 weeks apart).
const SEARCH_DAYS = 70;

const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

export function isScheduled(s: MeetingSchedule): boolean {
  return (
    s.frequency !== MeetingFrequencyEnum.NONE &&
    s.weekday !== null &&
    !!s.startTime
  );
}

// Whether the fellowship meets on this church-local date.
export function meetsOn(s: MeetingSchedule, date: string): boolean {
  if (!isScheduled(s) || weekdayOf(date) !== s.weekday) return false;
  if (s.startsOn && date < s.startsOn) return false;
  if (s.frequency === MeetingFrequencyEnum.WEEKLY) {
    if (s.intervalWeeks <= 1) return true;
    if (!s.startsOn) return false;
    return (dayDiff(s.startsOn, date) / 7) % s.intervalWeeks === 0;
  }
  const day = Number(date.slice(8, 10));
  if (s.weekOfMonth === -1) {
    const month = date.slice(5, 7);
    return addDays(date, 7).slice(5, 7) !== month;
  }
  return Math.ceil(day / 7) === s.weekOfMonth;
}

function startAt(s: MeetingSchedule, date: string, timezone: string): Date {
  return fromZonedTime(`${date}T${s.startTime}:00`, timezone);
}

// The first meeting starting after `after`, or null when there's no regular schedule.
export function nextMeeting(
  s: MeetingSchedule,
  after: Date,
  timezone: string,
): Date | null {
  if (!isScheduled(s)) return null;
  const from = localDate(after, timezone);
  for (let i = 0; i <= SEARCH_DAYS; i++) {
    const date = addDays(from, i);
    if (!meetsOn(s, date)) continue;
    const at = startAt(s, date, timezone);
    if (at > after) return at;
  }
  return null;
}

// The church-local date of the latest meeting on or before `onOrBefore`'s date.
export function lastMeetingDate(
  s: MeetingSchedule,
  onOrBefore: Date,
  timezone: string,
): string | null {
  if (!isScheduled(s)) return null;
  const from = localDate(onOrBefore, timezone);
  for (let i = 0; i <= SEARCH_DAYS; i++) {
    const date = addDays(from, -i);
    if (meetsOn(s, date)) return date;
  }
  return null;
}

function clock(time: string): string {
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// "Every Wednesday, 6:00 PM–8:00 PM", "Every 2 weeks on Friday, 6:00 PM", "First Saturday of the month, 10:00 AM".
export function describeSchedule(s: MeetingSchedule): string | null {
  if (!isScheduled(s)) return null;
  const day = WEEKDAYS[s.weekday!];
  const time = s.endTime
    ? `${clock(s.startTime!)}–${clock(s.endTime)}`
    : clock(s.startTime!);
  if (s.frequency === MeetingFrequencyEnum.MONTHLY) {
    const nth = ORDINALS[s.weekOfMonth!];
    return `${nth[0].toUpperCase()}${nth.slice(1)} ${day} of the month, ${time}`;
  }
  return s.intervalWeeks > 1
    ? `Every ${s.intervalWeeks} weeks on ${day}, ${time}`
    : `Every ${day}, ${time}`;
}

// Checks a schedule makes sense as a whole; the DTO checks each field.
export function assertValidSchedule(s: MeetingSchedule): void {
  if (s.frequency === MeetingFrequencyEnum.NONE) return;
  if (s.weekday === null || !s.startTime)
    throw new BadRequestException('Choose the day and start time it meets');
  if (s.endTime && s.endTime <= s.startTime)
    throw new BadRequestException('The end time must be after the start time');
  if (s.frequency === MeetingFrequencyEnum.MONTHLY && !s.weekOfMonth)
    throw new BadRequestException(
      'Choose which week of the month it meets (first to fourth, or last)',
    );
  if (s.frequency === MeetingFrequencyEnum.WEEKLY && s.intervalWeeks > 1) {
    if (!s.startsOn)
      throw new BadRequestException(
        `Choose the date of a meeting, so we know which weeks it meets every ${s.intervalWeeks} weeks`,
      );
    if (weekdayOf(s.startsOn) !== s.weekday)
      throw new BadRequestException(
        `The first meeting date must be a ${WEEKDAYS[s.weekday]}`,
      );
  }
}
