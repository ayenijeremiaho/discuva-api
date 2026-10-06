import {
  CalendarRepeatDisplay,
  ChurchCalendarEntry,
  ChurchCalendarItem,
} from '../entity/church-calendar.entity';

// An event occurrence already converted to the church's local date/time.
export interface CalendarOccurrence {
  eventId: string;
  seriesId: string | null;
  title: string;
  description?: string | null;
  date: string;
  time: string;
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
const DAY_MS = 86_400_000;
const weekdayOf = (date: string) =>
  WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
const gap = (a: string, b: string) =>
  Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS,
  );

// "Every Sunday", "Every other Wednesday", else "4 dates" — read from the dates themselves.
export function repeatLabel(dates: string[]): string {
  const gaps = dates.slice(1).map((d, i) => gap(dates[i], d));
  if (gaps.length && gaps.every((g) => g === 7))
    return `Every ${weekdayOf(dates[0])}`;
  if (gaps.length && gaps.every((g) => g === 14))
    return `Every other ${weekdayOf(dates[0])}`;
  if (gaps.length && gaps.every((g) => g === 1)) return 'Daily';
  return `${dates.length} dates`;
}

export const eventKey = (o: CalendarOccurrence) =>
  o.seriesId ? `series:${o.seriesId}` : `event:${o.eventId}`;

const sameItem = (
  a: { date: string; title: string },
  b: { date: string; title: string },
) =>
  a.date === b.date &&
  a.title.trim().toLowerCase() === b.title.trim().toLowerCase();

const byDateTime = (a: ChurchCalendarItem, b: ChurchCalendarItem) =>
  a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '');

// Merges manual entries with events; a manual entry duplicating an event is folded into it.
export function buildCalendarItems(
  entries: ChurchCalendarEntry[],
  occurrences: CalendarOccurrence[],
  repeatDisplay: CalendarRepeatDisplay,
): ChurchCalendarItem[] {
  const remaining = [...entries];
  const eventItems: ChurchCalendarItem[] = occurrences.map((o) => {
    const matchIndex = remaining.findIndex((e) => sameItem(e, o));
    const match = matchIndex >= 0 ? remaining.splice(matchIndex, 1)[0] : null;
    return {
      key: `event:${o.eventId}`,
      source: 'event',
      date: o.date,
      time: o.time,
      title: o.title,
      description: o.description || match?.description,
      imageUrl: match?.imageUrl,
    };
  });

  let shown = eventItems;
  if (repeatDisplay === CalendarRepeatDisplay.SUMMARY) {
    const bySeries = new Map<string, CalendarOccurrence[]>();
    occurrences.forEach((o) => {
      if (o.seriesId)
        bySeries.set(o.seriesId, [...(bySeries.get(o.seriesId) ?? []), o]);
    });
    const summarised = new Set<string>();
    shown = [];
    occurrences.forEach((o, i) => {
      const group = o.seriesId ? bySeries.get(o.seriesId)! : null;
      if (!group || group.length < 2) {
        shown.push(eventItems[i]);
        return;
      }
      if (summarised.has(o.seriesId!)) return;
      summarised.add(o.seriesId!);
      const dates = group.map((g) => g.date).sort();
      const times = new Set(group.map((g) => g.time));
      shown.push({
        key: `series:${o.seriesId}`,
        source: 'series',
        date: dates[0],
        time: times.size === 1 ? o.time : undefined,
        title: o.title,
        description: eventItems[i].description,
        imageUrl: eventItems[i].imageUrl,
        repeatLabel: repeatLabel(dates),
        dates,
      });
    });
  }

  const manual: ChurchCalendarItem[] = remaining.map((e) => ({
    key: e.id,
    source: 'entry',
    date: e.date,
    time: e.time,
    title: e.title,
    description: e.description,
    imageUrl: e.imageUrl,
  }));
  return [...shown, ...manual].sort(byDateTime);
}
