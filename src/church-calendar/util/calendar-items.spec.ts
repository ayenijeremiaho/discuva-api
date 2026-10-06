import { CalendarRepeatDisplay } from '../entity/church-calendar.entity';
import { buildCalendarItems, repeatLabel } from './calendar-items';

const occ = (eventId: string, date: string, over = {}) => ({
  eventId,
  seriesId: 's1',
  title: 'Sunday Service',
  date,
  time: '08:00',
  ...over,
});

describe('calendar items', () => {
  it('reads the repeat from the dates', () => {
    expect(repeatLabel(['2026-10-04', '2026-10-11', '2026-10-18'])).toBe(
      'Every Sunday',
    );
    expect(repeatLabel(['2026-10-07', '2026-10-21'])).toBe(
      'Every other Wednesday',
    );
    expect(repeatLabel(['2026-10-01', '2026-10-09'])).toBe('2 dates');
  });

  it('folds a manual entry that duplicates an event into it, keeping its photo', () => {
    const items = buildCalendarItems(
      [
        {
          id: 'm1',
          date: '2026-10-04',
          title: 'sunday service',
          imageUrl: 'x.jpg',
        },
      ],
      [occ('e1', '2026-10-04', { seriesId: null })],
      CalendarRepeatDisplay.SUMMARY,
    );
    expect(items).toEqual([
      expect.objectContaining({ key: 'event:e1', imageUrl: 'x.jpg' }),
    ]);
  });

  it('keeps manual entries and orders everything by date and time', () => {
    const items = buildCalendarItems(
      [{ id: 'm1', date: '2026-10-02', title: 'Fasting & Prayer' }],
      [occ('e1', '2026-10-04'), occ('e2', '2026-10-11')],
      CalendarRepeatDisplay.SUMMARY,
    );
    expect(items.map((i) => i.key)).toEqual(['m1', 'series:s1']);
  });

  it('shows a series with only one date in range as a normal event', () => {
    const items = buildCalendarItems(
      [],
      [occ('e1', '2026-10-04')],
      CalendarRepeatDisplay.SUMMARY,
    );
    expect(items).toEqual([
      expect.objectContaining({ key: 'event:e1', source: 'event' }),
    ]);
  });
});
