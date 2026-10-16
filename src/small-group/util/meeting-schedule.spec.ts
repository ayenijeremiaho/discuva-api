import { BadRequestException } from '@nestjs/common';
import { MeetingFrequencyEnum } from '../enum/meeting-frequency.enum';
import {
  MeetingSchedule,
  assertValidSchedule,
  describeSchedule,
  lastMeetingDate,
  meetsOn,
  nextMeeting,
} from './meeting-schedule';

const LAGOS = 'Africa/Lagos';
const s = (over: Partial<MeetingSchedule> = {}): MeetingSchedule => ({
  frequency: MeetingFrequencyEnum.WEEKLY,
  weekday: 3,
  startTime: '18:00',
  endTime: '20:00',
  intervalWeeks: 1,
  weekOfMonth: null,
  startsOn: null,
  ...over,
});

describe('meeting schedule', () => {
  it('weekly: the next Wednesday at 6 PM church time, after the current one has started', () => {
    // Wed 21 Oct 2026, 12:00 UTC = 1 PM Lagos.
    expect(nextMeeting(s(), new Date('2026-10-21T12:00:00Z'), LAGOS)).toEqual(
      new Date('2026-10-21T17:00:00Z'),
    );
    expect(nextMeeting(s(), new Date('2026-10-21T17:00:00Z'), LAGOS)).toEqual(
      new Date('2026-10-28T17:00:00Z'),
    );
  });

  it('every 2 weeks follows the first meeting date', () => {
    const fortnightly = s({ intervalWeeks: 2, startsOn: '2026-10-07' });
    expect(meetsOn(fortnightly, '2026-10-14')).toBe(false);
    expect(meetsOn(fortnightly, '2026-10-21')).toBe(true);
    expect(meetsOn(fortnightly, '2026-09-30')).toBe(false);
    expect(
      nextMeeting(fortnightly, new Date('2026-10-22T00:00:00Z'), LAGOS),
    ).toEqual(new Date('2026-11-04T17:00:00Z'));
  });

  it('monthly: the first or last Saturday of the month', () => {
    const first = s({
      frequency: MeetingFrequencyEnum.MONTHLY,
      weekday: 6,
      weekOfMonth: 1,
    });
    const last = { ...first, weekOfMonth: -1 };
    expect(meetsOn(first, '2026-11-07')).toBe(true);
    expect(meetsOn(first, '2026-11-14')).toBe(false);
    expect(meetsOn(last, '2026-10-31')).toBe(true);
    expect(meetsOn(last, '2026-10-24')).toBe(false);
    expect(nextMeeting(first, new Date('2026-11-08T00:00:00Z'), LAGOS)).toEqual(
      new Date('2026-12-05T17:00:00Z'),
    );
  });

  it('keeps local time across a clock change in a church that has daylight saving', () => {
    // New York leaves daylight saving on Sun 1 Nov 2026: 6 PM is 22:00 UTC before, 23:00 UTC after.
    const ny = 'America/New_York';
    expect(nextMeeting(s(), new Date('2026-10-28T12:00:00Z'), ny)).toEqual(
      new Date('2026-10-28T22:00:00Z'),
    );
    expect(nextMeeting(s(), new Date('2026-10-29T12:00:00Z'), ny)).toEqual(
      new Date('2026-11-04T23:00:00Z'),
    );
  });

  it('has no next meeting without a regular schedule, or before it starts', () => {
    expect(
      nextMeeting(
        s({ frequency: MeetingFrequencyEnum.NONE }),
        new Date(),
        LAGOS,
      ),
    ).toBeNull();
    expect(
      nextMeeting(
        s({ startsOn: '2026-12-02' }),
        new Date('2026-10-21T00:00:00Z'),
        LAGOS,
      ),
    ).toEqual(new Date('2026-12-02T17:00:00Z'));
  });

  it('finds the most recent meeting date for taking attendance', () => {
    expect(lastMeetingDate(s(), new Date('2026-10-23T09:00:00Z'), LAGOS)).toBe(
      '2026-10-21',
    );
    expect(lastMeetingDate(s(), new Date('2026-10-21T09:00:00Z'), LAGOS)).toBe(
      '2026-10-21',
    );
  });

  it('describes the schedule in plain words', () => {
    expect(describeSchedule(s())).toBe('Every Wednesday, 6:00 PM–8:00 PM');
    expect(
      describeSchedule(
        s({ intervalWeeks: 2, startsOn: '2026-10-07', endTime: null }),
      ),
    ).toBe('Every 2 weeks on Wednesday, 6:00 PM');
    expect(
      describeSchedule(
        s({
          frequency: MeetingFrequencyEnum.MONTHLY,
          weekday: 6,
          weekOfMonth: -1,
          startTime: '10:00',
          endTime: null,
        }),
      ),
    ).toBe('Last Saturday of the month, 10:00 AM');
    expect(
      describeSchedule(s({ frequency: MeetingFrequencyEnum.NONE })),
    ).toBeNull();
  });

  it('rejects schedules that cannot work', () => {
    const bad = (over: Partial<MeetingSchedule>) => () =>
      assertValidSchedule(s(over));
    expect(bad({ startTime: null })).toThrow(BadRequestException);
    expect(bad({ endTime: '17:00' })).toThrow('end time must be after');
    expect(
      bad({ frequency: MeetingFrequencyEnum.MONTHLY, weekOfMonth: null }),
    ).toThrow('week of the month');
    expect(bad({ intervalWeeks: 2 })).toThrow('date of a meeting');
    expect(bad({ intervalWeeks: 2, startsOn: '2026-10-08' })).toThrow(
      'must be a Wednesday',
    );
    expect(
      bad({ frequency: MeetingFrequencyEnum.NONE, startTime: null }),
    ).not.toThrow();
  });
});
