export interface DateSearch {
  day?: number;
  month?: number;
  year?: number;
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const WEEKDAYS =
  /^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day|nesday|rsday|urday)?$/;

// "oct", "octo", "october" and "sept" all count; two letters are too ambiguous.
const monthOf = (word: string): number | undefined => {
  if (word === 'sept') return 9;
  if (word.length < 3) return undefined;
  const i = MONTHS.findIndex((m) => m.startsWith(word));
  return i === -1 ? undefined : i + 1;
};

const valid = ({ day, month, year }: DateSearch): boolean =>
  (day === undefined || (day >= 1 && day <= 31)) &&
  (month === undefined || (month >= 1 && month <= 12)) &&
  (year === undefined || (year >= 2000 && year <= 2100));

// Reads an event search as a date when it is one: "11", "11th", "11 Oct", "October 11th", "Sunday 11 October",
// "11/10", "11/10/2026", "2026-10-11", "October", "2026". Day comes before month, as the app shows dates.
// Anything with other words returns null, so it's searched by name only.
export function parseDateSearch(input: string): DateSearch | null {
  const q = input.trim().toLowerCase().replace(/,/g, ' ');
  if (!q) return null;

  const iso = q.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const found = { year: +iso[1], month: +iso[2], day: +iso[3] };
    return valid(found) ? found : null;
  }
  const numeric = q.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/);
  if (numeric) {
    const year = numeric[3]
      ? numeric[3].length === 2
        ? 2000 + +numeric[3]
        : +numeric[3]
      : undefined;
    const found = {
      day: +numeric[1],
      month: +numeric[2],
      ...(year ? { year } : {}),
    };
    return valid(found) ? found : null;
  }

  const found: DateSearch = {};
  for (const token of q.split(/\s+/)) {
    if (token === 'of' || WEEKDAYS.test(token)) continue;
    const number = token.match(/^(\d{1,4})(st|nd|rd|th)?$/);
    if (number) {
      const n = +number[1];
      if (number[1].length === 4 && !number[2] && found.year === undefined)
        found.year = n;
      else if (number[1].length <= 2 && found.day === undefined) found.day = n;
      else return null;
      continue;
    }
    const month = monthOf(token.replace(/\.$/, ''));
    if (month && found.month === undefined) {
      found.month = month;
      continue;
    }
    return null;
  }
  if (
    found.day === undefined &&
    found.month === undefined &&
    found.year === undefined
  )
    return null;
  return valid(found) ? found : null;
}
