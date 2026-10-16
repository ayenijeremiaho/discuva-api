import { MigrationInterface, QueryRunner } from 'typeorm';

const WEEKDAY =
  /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|weds|wed|thurs|thur|thu|fri|sat)s?\b/g;
// Every spelling starts with the day's first three letters.
const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};
const ORDINAL: Record<string, number> = {
  first: 1,
  '1st': 1,
  second: 2,
  '2nd': 2,
  third: 3,
  '3rd': 3,
  fourth: 4,
  '4th': 4,
  last: -1,
};
const RANGE =
  /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:-|–|to)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/;
const TIME_12 = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/;
const TIME_24 = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/;
const UNSURE =
  /\b(other|alternate|alternating|bi-?weekly|fortnight\w*|every\s+\d|twice|and|&)\b/;
const FILLER =
  /\b(every|each|on|weekly|monthly|of|the|month|at|from|by|evening|evenings|morning|mornings|afternoon|afternoons|night|nights|s)\b/g;

const hhmm = (h: number, m: number) =>
  `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
const to24 = (h: number, m: number, meridiem: string) =>
  hhmm((h % 12) + (meridiem === 'pm' ? 12 : 0), m);

interface Parsed {
  frequency: 'WEEKLY' | 'MONTHLY';
  weekday: number;
  startTime: string;
  endTime: string | null;
  weekOfMonth: number | null;
  keepNotes: boolean;
}

// Only text that names one weekday and a clear time becomes a schedule; anything ambiguous is left for a person.
function parse(raw: string): Parsed | null {
  const text = raw.toLowerCase();
  if (UNSURE.test(text)) return null;
  const days = [
    ...new Set(
      [...text.matchAll(WEEKDAY)].map((m) => WEEKDAY_INDEX[m[1].slice(0, 3)]),
    ),
  ];
  if (days.length !== 1) return null;

  let startTime: string | null = null;
  let endTime: string | null = null;
  let rest = text;
  const range = text.match(RANGE);
  if (range) {
    const endMeridiem = range[6];
    startTime = to24(+range[1], +(range[2] ?? 0), range[3] ?? endMeridiem);
    endTime = to24(+range[4], +(range[5] ?? 0), endMeridiem);
    rest = rest.replace(range[0], ' ');
  } else {
    const t12 = text.match(TIME_12);
    const t24 = text.match(TIME_24);
    if (t12) {
      startTime = to24(+t12[1], +(t12[2] ?? 0), t12[3]);
      rest = rest.replace(t12[0], ' ');
    } else if (t24) {
      startTime = hhmm(+t24[1], +t24[2]);
      rest = rest.replace(t24[0], ' ');
    }
  }
  if (!startTime || +startTime.slice(0, 2) > 23) return null;
  if (endTime && endTime <= startTime) endTime = null;

  const ordinal = Object.keys(ORDINAL).find((o) =>
    new RegExp(`\\b${o}\\b`).test(text),
  );
  for (const o of Object.keys(ORDINAL))
    rest = rest.replace(new RegExp(`\\b${o}\\b`, 'g'), ' ');
  rest = rest
    .replace(WEEKDAY, ' ')
    .replace(FILLER, ' ')
    .replace(/[^a-z0-9]+/g, '');
  return {
    frequency: ordinal ? 'MONTHLY' : 'WEEKLY',
    weekday: days[0],
    startTime,
    endTime,
    weekOfMonth: ordinal ? ORDINAL[ordinal] : null,
    keepNotes: rest.length > 0,
  };
}

// A fellowship's meeting day was free text; it becomes a schedule (day, time, how often) where it reads clearly.
export class AddSmallGroupMeetingSchedule1803024000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE small_groups
        ADD COLUMN IF NOT EXISTS meeting_frequency VARCHAR NOT NULL DEFAULT 'NONE',
        ADD COLUMN IF NOT EXISTS meeting_weekday SMALLINT,
        ADD COLUMN IF NOT EXISTS meeting_start_time VARCHAR(5),
        ADD COLUMN IF NOT EXISTS meeting_end_time VARCHAR(5),
        ADD COLUMN IF NOT EXISTS meeting_interval_weeks SMALLINT NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS meeting_week_of_month SMALLINT,
        ADD COLUMN IF NOT EXISTS meeting_starts_on DATE,
        ADD COLUMN IF NOT EXISTS meeting_notes TEXT`);

    const rows: { id: string; meeting_day: string }[] = await queryRunner.query(
      `SELECT id, meeting_day FROM small_groups
        WHERE meeting_day IS NOT NULL AND btrim(meeting_day) <> '' AND meeting_frequency = 'NONE'`,
    );
    for (const row of rows) {
      const p = parse(row.meeting_day);
      if (!p) {
        await queryRunner.query(
          `UPDATE small_groups SET meeting_notes = COALESCE(meeting_notes, $2) WHERE id = $1`,
          [row.id, row.meeting_day.trim()],
        );
        continue;
      }
      await queryRunner.query(
        `UPDATE small_groups
            SET meeting_frequency = $2, meeting_weekday = $3, meeting_start_time = $4, meeting_end_time = $5,
                meeting_week_of_month = $6, meeting_notes = COALESCE(meeting_notes, $7)
          WHERE id = $1`,
        [
          row.id,
          p.frequency,
          p.weekday,
          p.startTime,
          p.endTime,
          p.weekOfMonth,
          p.keepNotes ? row.meeting_day.trim() : null,
        ],
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE small_groups
        DROP COLUMN IF EXISTS meeting_frequency,
        DROP COLUMN IF EXISTS meeting_weekday,
        DROP COLUMN IF EXISTS meeting_start_time,
        DROP COLUMN IF EXISTS meeting_end_time,
        DROP COLUMN IF EXISTS meeting_interval_weeks,
        DROP COLUMN IF EXISTS meeting_week_of_month,
        DROP COLUMN IF EXISTS meeting_starts_on,
        DROP COLUMN IF EXISTS meeting_notes`);
  }
}
